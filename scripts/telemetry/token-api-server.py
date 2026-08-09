#!/usr/bin/env python3
"""
Token Usage API Server for ForgeWright Dashboard

Serves token usage data via REST API for the dashboard.

Usage:
    python3 scripts/token-api-server.py [--host 127.0.0.1] [--port 8080]

Then open: http://127.0.0.1:8080/dashboard
"""

import argparse
import base64
import ipaddress
import json
import os
import secrets
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

# Try Flask, fallback to http.server
try:
    from flask import Flask, Response, jsonify, request, send_file

    HAS_FLASK = True
except ImportError:
    HAS_FLASK = False
    print("⚠️  Flask not installed. Using basic http.server.")
    print("   Install with: pip install flask")
    print("   Or run dashboard directly as HTML file.\n")

# Provider pricing (USD per 1M tokens)
# Note: Cursor stores call counts, not tokens. Cost is estimated.
PRICING = {
    "anthropic": {
        # Claude 4 series (2026)
        "claude-4.6-opus": {
            "input": 15.0,
            "output": 75.0,
            "estimate_tokens_per_call": 5000,
        },
        "claude-4.5-opus": {
            "input": 15.0,
            "output": 75.0,
            "estimate_tokens_per_call": 5000,
        },
        "claude-4-opus": {
            "input": 15.0,
            "output": 75.0,
            "estimate_tokens_per_call": 5000,
        },
        # Claude 3.5 series
        "claude-3-5-sonnet-20241022": {
            "input": 3.0,
            "output": 15.0,
            "estimate_tokens_per_call": 3000,
        },
        "claude-3-5-sonnet": {
            "input": 3.0,
            "output": 15.0,
            "estimate_tokens_per_call": 3000,
        },
        "claude-3-5-haiku-20241022": {
            "input": 0.8,
            "output": 4.0,
            "estimate_tokens_per_call": 1500,
        },
        # Claude 3 series
        "claude-3-opus-20240229": {
            "input": 15.0,
            "output": 75.0,
            "estimate_tokens_per_call": 4000,
        },
        "claude-3-haiku-20240307": {
            "input": 0.25,
            "output": 1.25,
            "estimate_tokens_per_call": 1500,
        },
        "claude-sonnet-4-20250514": {
            "input": 3.0,
            "output": 15.0,
            "estimate_tokens_per_call": 3000,
        },
    },
    "openai": {
        # GPT-5 series (2026)
        "gpt-5.4": {"input": 10.0, "output": 40.0, "estimate_tokens_per_call": 4000},
        "gpt-5": {"input": 10.0, "output": 40.0, "estimate_tokens_per_call": 4000},
        "gpt-5.4-mini": {"input": 0.5, "output": 2.0, "estimate_tokens_per_call": 2500},
        # GPT-4o series
        "gpt-4o": {"input": 2.5, "output": 10.0, "estimate_tokens_per_call": 3000},
        "gpt-4o-mini": {
            "input": 0.15,
            "output": 0.60,
            "estimate_tokens_per_call": 2000,
        },
        "gpt-4-turbo": {
            "input": 10.0,
            "output": 30.0,
            "estimate_tokens_per_call": 3000,
        },
    },
    "google": {
        "gemini-2.5-pro": {
            "input": 1.25,
            "output": 5.0,
            "estimate_tokens_per_call": 4000,
        },
        "gemini-2.5-flash": {
            "input": 0.075,
            "output": 0.30,
            "estimate_tokens_per_call": 2500,
        },
        "gemini-2-pro": {
            "input": 1.25,
            "output": 5.0,
            "estimate_tokens_per_call": 4000,
        },
        "gemini-2-flash": {
            "input": 0.075,
            "output": 0.30,
            "estimate_tokens_per_call": 2500,
        },
    },
}

# Model name normalization patterns
DASHBOARD_AUTH_ENV = "FORGEWRIGHT_TOKEN_DASHBOARD_AUTH_TOKEN"
DASHBOARD_AUTH_USER = "forgewright"


def is_loopback_host(host: str) -> bool:
    normalized = host.strip().lower()
    if normalized == "localhost":
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def validate_bind_policy(host: str, auth_token: str) -> None:
    if not host.strip():
        raise ValueError("dashboard bind host cannot be empty")
    if not is_loopback_host(host) and not auth_token:
        raise ValueError(
            f"non-loopback dashboard binding requires {DASHBOARD_AUTH_ENV}"
        )


def _expected_basic_auth(auth_token: str) -> str:
    payload = f"{DASHBOARD_AUTH_USER}:{auth_token}".encode("utf-8")
    return "Basic " + base64.b64encode(payload).decode("ascii")


def is_authorized_request(authorization: str | None, auth_token: str) -> bool:
    if not auth_token:
        return True
    return secrets.compare_digest(authorization or "", _expected_basic_auth(auth_token))


# Model name normalization patterns
MODEL_ALIASES = {
    # Cursor models -> standard names
    "claude-4.6-opus-max-thinking-fast": "claude-4.6-opus",
    "claude-4.6-opus-high-thinking-fast": "claude-4.6-opus",
    "claude-4-opus": "claude-4-opus",
    "gpt-5.4-high-fast": "gpt-5.4",
    "gpt-5.4-xhigh-fast": "gpt-5.4",
    "gpt-4o": "gpt-4o",
    # Claude Code models -> standard names
    "claude-sonnet-4-6": "claude-sonnet-4",
    "claude-haiku-4-5": "claude-haiku-4",
    "claude-sonnet-4": "claude-sonnet-4",
    "claude-haiku-4": "claude-haiku-4",
}


def get_pricing_for_model(model_name: str) -> dict:
    """Get pricing info for a model by matching name patterns."""
    model_lower = model_name.lower()

    # Check exact aliases first
    for alias, canonical in MODEL_ALIASES.items():
        if alias.lower() in model_lower or model_lower in alias.lower():
            for provider, models in PRICING.items():
                for model_key, pricing in models.items():
                    if model_key.lower() in canonical.lower():
                        return pricing

    # Try matching by prefix
    for provider, models in PRICING.items():
        for model_key, pricing in models.items():
            if model_key.lower() in model_lower or model_lower.startswith(
                model_key.lower().split("-")[0]
            ):
                return pricing

    # Default estimate for unknown models
    return {"input": 5.0, "output": 20.0, "estimate_tokens_per_call": 3000}


def estimate_cost(call_count: int, model_name: str) -> float:
    """Estimate cost for Cursor calls (no token data available)."""
    pricing = get_pricing_for_model(model_name)
    tokens_per_call = pricing.get("estimate_tokens_per_call", 3000)
    total_input = call_count * tokens_per_call * 0.7  # 70% input
    total_output = call_count * tokens_per_call * 0.3  # 30% output
    return (total_input / 1_000_000) * pricing["input"] + (
        total_output / 1_000_000
    ) * pricing["output"]


# Dashboard HTML (inline)
DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Usage Dashboard - ForgeWright</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121c;
      --bg-card: #1a1a28;
      --accent-cyan: #00d4ff;
      --accent-magenta: #ff0080;
      --accent-yellow: #ffcc00;
      --accent-green: #00ff88;
      --text-primary: #ffffff;
      --text-secondary: #8888aa;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      background-image: 
        radial-gradient(ellipse at 10% 20%, rgba(0, 212, 255, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 90% 80%, rgba(255, 0, 128, 0.06) 0%, transparent 50%);
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    h1 {
      font-size: 1.5rem;
      background: linear-gradient(135deg, var(--accent-cyan), var(--accent-magenta));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .controls { display: flex; gap: 0.75rem; align-items: center; }
    select, button {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
      padding: 0.6rem 1rem;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1);
      background: var(--bg-card);
      color: var(--text-primary);
      cursor: pointer;
    }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent-cyan), #a855f7);
      color: var(--bg-primary);
      border: none;
      font-weight: 500;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 1.5rem;
      border: 1px solid rgba(255,255,255,0.08);
      position: relative;
      overflow: hidden;
    }
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
    }
    .stat-card.cyan::before { background: var(--accent-cyan); }
    .stat-card.magenta::before { background: var(--accent-magenta); }
    .stat-card.yellow::before { background: var(--accent-yellow); }
    .stat-card.green::before { background: var(--accent-green); }
    .stat-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }
    .stat-value {
      font-family: 'JetBrains Mono', monospace;
      font-size: 2rem;
      font-weight: 700;
    }
    .stat-card.cyan .stat-value { color: var(--accent-cyan); }
    .stat-card.magenta .stat-value { color: var(--accent-magenta); }
    .stat-card.yellow .stat-value { color: var(--accent-yellow); }
    .stat-card.green .stat-value { color: var(--accent-green); }
    .stat-meta { font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem; }
    .charts-section {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.5rem;
      margin-bottom: 2rem;
    }
    .chart-card {
      background: var(--bg-card);
      border-radius: 16px;
      padding: 1.5rem;
      border: 1px solid rgba(255,255,255,0.08);
    }
    .chart-title {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 1rem;
    }
    .bottom-section {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    .model-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .model-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border-radius: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8rem;
    }
    .model-badge {
      font-size: 0.65rem;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge-anthropic { background: rgba(255, 115, 0, 0.2); color: #ff7300; }
    .badge-openai { background: rgba(16, 163, 74, 0.2); color: #10a34a; }
    .badge-google { background: rgba(26, 115, 232, 0.2); color: #4285f4; }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      text-align: left;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    th {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
    }
    td { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      color: var(--text-secondary);
    }
    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid rgba(255,255,255,0.1);
      border-top-color: var(--accent-cyan);
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-right: 0.75rem;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 1200px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .charts-section, .bottom-section { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>⚡ Token Usage Dashboard</h1>
      <div class="controls">
        <select id="project">
          <option value="">Loading...</option>
        </select>
        <select id="period">
          <option value="7">Last 7 Days</option>
          <option value="30">Last 30 Days</option>
          <option value="1">Today</option>
        </select>
        <button class="btn-primary" onclick="refreshData()">Refresh</button>
      </div>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card cyan">
        <div class="stat-label">Total Tokens</div>
        <div class="stat-value" id="totalTokens">-</div>
        <div class="stat-meta" id="tokenMeta">-</div>
      </div>
      <div class="stat-card magenta">
        <div class="stat-label">Total Cost</div>
        <div class="stat-value" id="totalCost">-</div>
        <div class="stat-meta" id="costMeta">-</div>
      </div>
      <div class="stat-card yellow">
        <div class="stat-label">LLM Calls</div>
        <div class="stat-value" id="totalCalls">-</div>
        <div class="stat-meta" id="callsMeta">-</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">Avg Latency</div>
        <div class="stat-value" id="avgLatency">-</div>
        <div class="stat-meta">P50 latency</div>
      </div>
    </div>
    
    <div class="charts-section">
      <div class="chart-card">
        <div class="chart-title">Token Usage Over Time</div>
        <canvas id="trendChart"></canvas>
      </div>
      <div class="chart-card">
        <div class="chart-title">Cost by Provider</div>
        <canvas id="providerChart"></canvas>
      </div>
    </div>
    
    <div class="bottom-section">
      <div class="chart-card">
        <div class="chart-title">Top Models</div>
        <div class="model-list" id="modelList"><div class="loading"><div class="spinner"></div>Loading...</div></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Recent Sessions</div>
        <table>
          <thead>
            <tr><th>Session</th><th>Model</th><th>Tokens</th><th>Cost</th></tr>
          </thead>
          <tbody id="sessionsTable"></tbody>
        </table>
      </div>
    </div>
  </div>
  
  <script>
    let trendChart = null;
    let providerChart = null;
    let currentData = null;

    function formatNumber(n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return n?.toString() || '0';
    }

    function getProviderBadge(provider) {
      return provider === 'anthropic' ? 'badge-anthropic' 
           : provider === 'openai' ? 'badge-openai' 
           : 'badge-google';
    }

    async function loadProjects() {
      try {
        const res = await fetch('/api/projects');
        const projects = await res.json();
        const select = document.getElementById('project');
        select.innerHTML = projects.map(p => `<option value="${p}">${p}</option>`).join('');
      } catch (e) {
        console.error('Failed to load projects:', e);
      }
    }

    async function refreshData() {
      const project = document.getElementById('project').value;
      const period = document.getElementById('period').value;
      
      try {
        const res = await fetch(`/api/usage?project=${project}&period=${period}`);
        currentData = await res.json();
        updateDashboard(currentData);
      } catch (e) {
        console.error('Failed to fetch data:', e);
      }
    }

    function updateDashboard(data) {
      if (!data || !data.summary) return;
      const s = data.summary;
      
      document.getElementById('totalTokens').textContent = formatNumber(s.total_tokens);
      document.getElementById('totalCost').textContent = '$' + (s.total_cost_usd || 0).toFixed(2);
      document.getElementById('totalCalls').textContent = formatNumber(s.total_calls);
      document.getElementById('avgLatency').textContent = s.avg_latency_ms + 'ms';
      document.getElementById('tokenMeta').textContent = `${formatNumber(s.total_input_tokens)} in / ${formatNumber(s.total_output_tokens)} out`;
      document.getElementById('callsMeta').textContent = `~${formatNumber(Math.round(s.total_tokens / Math.max(s.total_calls, 1)))} per call`;
      
      updateTrendChart(data.trend);
      updateProviderChart(data.by_provider);
      updateModelList(data.by_model);
      updateSessionsTable(data);
    }

    function updateTrendChart(trend) {
      const ctx = document.getElementById('trendChart').getContext('2d');
      if (trendChart) trendChart.destroy();
      
      trendChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: trend?.labels || [],
          datasets: [
            { label: 'Input', data: trend?.inputTokens || [], borderColor: '#00d4ff', backgroundColor: 'rgba(0,212,255,0.1)', fill: true, tension: 0.4 },
            { label: 'Output', data: trend?.outputTokens || [], borderColor: '#ff0080', backgroundColor: 'rgba(255,0,128,0.1)', fill: true, tension: 0.4 }
          ]
        },
        options: {
          responsive: true,
          plugins: { legend: { labels: { color: '#8888aa' } } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8888aa' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8888aa', callback: v => formatNumber(v) } }
          }
        }
      });
    }

    function updateProviderChart(providers) {
      const ctx = document.getElementById('providerChart').getContext('2d');
      if (providerChart) providerChart.destroy();
      
      if (!providers) return;
      
      const labels = Object.keys(providers).map(p => p.charAt(0).toUpperCase() + p.slice(1));
      const costs = Object.values(providers).map(p => p.cost);
      
      providerChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: costs, backgroundColor: ['#ff7300', '#10a34a', '#4285f4'], borderWidth: 3 }] },
        options: { responsive: true, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: '#8888aa' } } } }
      });
    }

    function updateModelList(models) {
      const container = document.getElementById('modelList');
      if (!models || Object.keys(models).length === 0) {
        container.innerHTML = '<div style="color:#8888aa;text-align:center;padding:2rem;">No data</div>';
        return;
      }
      
      const sorted = Object.entries(models).sort((a, b) => b[1].cost - a[1].cost).slice(0, 5);
      container.innerHTML = sorted.map(([name, data]) => `
        <div class="model-item">
          <span><span class="model-badge ${getProviderBadge(data.provider || 'anthropic')}">${(data.provider || 'anthropic').slice(0,3)}</span> ${name.split('-').slice(0,3).join('-')}</span>
          <span>${formatNumber(data.tokens)} tokens · $${data.cost.toFixed(4)}</span>
        </div>
      `).join('');
    }

    function updateSessionsTable(data) {
      const tbody = document.getElementById('sessionsTable');
      tbody.innerHTML = (data.recent_sessions || []).slice(0, 5).map(s => `
        <tr><td style="color:#555">${s.session_id?.slice(0, 12)}...</td><td>${s.model?.split('-').slice(0,2).join('-')}</td><td>${formatNumber(s.tokens)}</td><td>$${s.cost.toFixed(4)}</td></tr>
      `).join('') || '<tr><td colspan="4" style="text-align:center;color:#888">No sessions</td></tr>';
    }

    document.getElementById('period').addEventListener('change', refreshData);
    document.getElementById('project').addEventListener('change', refreshData);
    
    loadProjects().then(refreshData);
  </script>
</body>
</html>
"""


class CursorDBReader:
    """Read model usage data from Cursor's SQLite database."""

    DB_PATH = Path.home() / ".cursor/ai-tracking/ai-code-tracking.db"

    def __init__(self):
        self.db_path = self.DB_PATH

    def is_available(self) -> bool:
        """Check if Cursor DB is available."""
        return self.db_path.exists() and self.db_path.stat().st_size > 0

    def get_model_stats(self) -> list:
        """Get aggregated model usage statistics with estimated costs."""
        if not self.is_available():
            return []

        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT
                    model,
                    COUNT(*) as call_count,
                    COUNT(DISTINCT conversationId) as conversations,
                    MAX(createdAt) as last_used
                FROM ai_code_hashes
                WHERE model IS NOT NULL
                    AND model != 'default'
                    AND model != ''
                GROUP BY model
                ORDER BY call_count DESC
            """)
            rows = cursor.fetchall()
            conn.close()

            # Add estimated cost
            results = []
            for row in rows:
                stats = dict(row)
                stats["estimated_cost"] = estimate_cost(
                    stats["call_count"], stats["model"]
                )
                stats["provider"] = (
                    "anthropic"
                    if "claude" in stats["model"].lower()
                    else "openai"
                    if "gpt" in stats["model"].lower()
                    else "unknown"
                )
                results.append(stats)

            return results
        except (sqlite3.Error, Exception) as e:
            print(f"Error reading Cursor DB: {e}")
            return []

    def get_conversations(self) -> list:
        """Get recent conversations with model info."""
        if not self.is_available():
            return []

        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT
                    conversationId,
                    model,
                    title,
                    updatedAt
                FROM conversation_summaries
                WHERE model IS NOT NULL
                    AND model != 'default'
                ORDER BY updatedAt DESC
                LIMIT 50
            """)
            rows = cursor.fetchall()
            conn.close()
            return [dict(row) for row in rows]
        except (sqlite3.Error, Exception) as e:
            print(f"Error reading Cursor conversations: {e}")
            return []

    def get_projects(self) -> list:
        """Get unique project paths with usage stats."""
        if not self.is_available():
            return []

        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.row_factory = sqlite3.Row
            cursor = conn.execute("""
                SELECT
                    fileName,
                    model,
                    COUNT(*) as changes,
                    MAX(createdAt) as last_used
                FROM ai_code_hashes
                WHERE fileName IS NOT NULL
                    AND model IS NOT NULL
                    AND model != 'default'
                GROUP BY fileName, model
                ORDER BY changes DESC
            """)
            rows = cursor.fetchall()
            conn.close()

            # Aggregate by project directory (first 4 path components)
            projects = {}
            for row in rows:
                entry = dict(row)
                full_path = entry["fileName"]

                # Extract project root from path like /Users/name/Documents/GitHub/{project}/...
                # Path starts with / so parts[0] is empty
                parts = full_path.split("/")
                # Find "GitHub" in path to locate project
                github_idx = -1
                for i, p in enumerate(parts):
                    if p == "GitHub" and i + 1 < len(parts):
                        github_idx = i + 1
                        break

                if github_idx > 0:
                    project_name = parts[github_idx]
                    project_root = "/".join(parts[: github_idx + 1])
                else:
                    project_name = parts[-2] if len(parts) > 1 else "unknown"
                    project_root = full_path

                if project_root not in projects:
                    projects[project_root] = {
                        "path": project_root,
                        "name": project_name,
                        "total_changes": 0,
                        "models": {},
                        "last_used": 0,
                    }

                model = entry["model"]
                changes = entry["changes"]
                projects[project_root]["total_changes"] += changes
                projects[project_root]["models"][model] = changes
                projects[project_root]["last_used"] = max(
                    projects[project_root]["last_used"], entry["last_used"] or 0
                )

            # Calculate costs
            for project in projects.values():
                project["estimated_cost"] = sum(
                    estimate_cost(count, model)
                    for model, count in project["models"].items()
                )

            return sorted(
                projects.values(), key=lambda x: x["total_changes"], reverse=True
            )[:20]
        except (sqlite3.Error, Exception) as e:
            print(f"Error reading Cursor projects: {e}")
            return []


class ClaudeTelemetryReader:
    """Read usage data from Claude Code telemetry."""

    TELEMETRY_PATH = Path.home() / ".claude" / "telemetry"

    def is_available(self) -> bool:
        """Check if Claude Code telemetry is available."""
        return self.TELEMETRY_PATH.exists() and any(self.TELEMETRY_PATH.glob("*.json"))

    def get_sessions(self) -> list:
        """Parse session info from telemetry files."""
        if not self.is_available():
            return []

        sessions = {}
        cwd_map = {}  # session_id -> working directory

        try:
            # First pass: collect cwd info from shell_set_cwd events
            for f in self.TELEMETRY_PATH.glob("*.json"):
                with open(f) as fp:
                    for line in fp:
                        try:
                            wrapper = json.loads(line)
                            # Data is nested inside event_data
                            event = wrapper.get("event_data", wrapper)
                            event_name = event.get("event_name", "")
                            sid = event.get("session_id", "")

                            if event_name == "tengu_shell_set_cwd":
                                meta_str = event.get("additional_metadata", "{}")
                                meta = (
                                    json.loads(meta_str)
                                    if isinstance(meta_str, str)
                                    else meta_str
                                )
                                if meta.get("success"):
                                    cwd_map[sid] = meta.get("cwd", "")

                            elif event_name == "tengu_started" and sid:
                                env = event.get("env", {})
                                sessions[sid] = {
                                    "session_id": sid,
                                    "model": event.get("model", "unknown"),
                                    "start_time": event.get("client_timestamp"),
                                    "version": env.get("version"),
                                    "platform": env.get("platform", "unknown"),
                                    "cwd": cwd_map.get(sid, ""),
                                    "betas": event.get("betas", ""),
                                }
                        except (json.JSONDecodeError, KeyError, TypeError):
                            continue

            return list(sessions.values())
        except Exception as e:
            print(f"Error reading Claude telemetry: {e}")
            return []

    def get_model_usage(self) -> list:
        """Aggregate model usage from sessions."""
        sessions = self.get_sessions()

        models = {}
        for s in sessions:
            model = s.get("model", "unknown")
            if model not in models:
                models[model] = {"model": model, "session_count": 0}
            models[model]["session_count"] += 1

        return list(models.values())

    def get_projects(self) -> list:
        """Get unique projects from working directories."""
        sessions = self.get_sessions()

        projects = {}
        for s in sessions:
            cwd = s.get("cwd", "")
            if not cwd or "/" not in cwd:
                continue

            # Extract project from /Users/name/Documents/GitHub/{project}/...
            parts = cwd.split("/")
            github_idx = -1
            for i, p in enumerate(parts):
                if p == "GitHub" and i + 1 < len(parts):
                    github_idx = i + 1
                    break

            if github_idx > 0:
                project_name = parts[github_idx]
                project_root = "/".join(parts[: github_idx + 1])

                if project_root not in projects:
                    projects[project_root] = {
                        "name": project_name,
                        "path": project_root,
                        "session_count": 0,
                        "models": set(),
                    }

                projects[project_root]["session_count"] += 1
                projects[project_root]["models"].add(s.get("model", "unknown"))

        # Convert sets to lists for JSON serialization
        for p in projects.values():
            p["models"] = list(p["models"])

        return sorted(projects.values(), key=lambda x: x["session_count"], reverse=True)


class UnifiedAggregator:
    """Merge usage data from multiple platforms."""

    def __init__(self):
        self.cursor_reader = CursorDBReader()
        self.claude_reader = ClaudeTelemetryReader()

    def get_summary(self) -> dict:
        """Get unified summary across all platforms."""
        summary = {
            "platforms": {
                "cursor": {"available": False, "calls": 0, "estimated_cost": 0},
                "claude-code": {"available": False, "sessions": 0, "models": []},
                "forgewright": {"available": False, "calls": 0, "tokens": 0, "cost": 0},
            },
            "by_model": {},
            "total_estimated_cost": 0,
        }

        # Cursor data
        if self.cursor_reader.is_available():
            cursor_models = self.cursor_reader.get_model_stats()
            cursor_calls = sum(m.get("call_count", 0) for m in cursor_models)
            cursor_cost = sum(m.get("estimated_cost", 0) for m in cursor_models)
            summary["platforms"]["cursor"] = {
                "available": True,
                "calls": cursor_calls,
                "estimated_cost": cursor_cost,
                "models": len(cursor_models),
            }
            summary["total_estimated_cost"] += cursor_cost

        # Claude Code data
        if self.claude_reader.is_available():
            claude_sessions = self.claude_reader.get_sessions()
            claude_models = self.claude_reader.get_model_usage()
            summary["platforms"]["claude-code"] = {
                "available": True,
                "sessions": len(claude_sessions),
                "models": claude_models,
            }

        return summary

    def get_by_platform(self) -> dict:
        """Get usage broken down by platform."""
        return {
            "cursor": self.cursor_reader.get_model_stats()
            if self.cursor_reader.is_available()
            else [],
            "claude": self.claude_reader.get_model_usage()
            if self.claude_reader.is_available()
            else [],
        }


class TokenAPI:
    def __init__(self):
        self.home = os.path.expanduser("~")
        self.base_path = Path(self.home) / ".forgewright" / "usage"

    def calculate_cost(
        self, provider: str, model: str, input_tokens: int, output_tokens: int
    ) -> float:
        provider_prices = PRICING.get(provider, {})
        prices = provider_prices.get(model)

        if not prices:
            for key, value in provider_prices.items():
                if key in model or model in key:
                    prices = value
                    break

        if not prices:
            return 0.0

        return (input_tokens / 1_000_000) * prices["input"] + (
            output_tokens / 1_000_000
        ) * prices["output"]

    def list_projects(self) -> list:
        if not self.base_path.exists():
            return []
        return sorted([d.name for d in self.base_path.iterdir() if d.is_dir()])

    def load_records(self, project: str, period: int = 7) -> list:
        records = []
        project_dir = self.base_path / project

        if not project_dir.exists():
            return records

        for i in range(period):
            date = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            file = project_dir / f"{date}.jsonl"

            if file.exists():
                with open(file) as f:
                    for line in f:
                        if line.strip():
                            try:
                                records.append(json.loads(line))
                            except json.JSONDecodeError:
                                continue

        return records

    def get_usage(self, project: str, period: int = 7) -> dict:
        records = self.load_records(project, period)

        if not records:
            return {
                "project": project,
                "period_days": period,
                "summary": {
                    "total_input_tokens": 0,
                    "total_output_tokens": 0,
                    "total_tokens": 0,
                    "total_calls": 0,
                    "total_cost_usd": 0,
                    "avg_latency_ms": 0,
                },
                "by_provider": {},
                "by_model": {},
                "trend": {"labels": [], "inputTokens": [], "outputTokens": []},
                "recent_sessions": [],
            }

        total_input = sum(r.get("inputTokens", 0) for r in records)
        total_output = sum(r.get("outputTokens", 0) for r in records)
        total_calls = len(records)
        total_latency = sum(r.get("latencyMs", 0) for r in records)

        by_provider = defaultdict(
            lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0}
        )
        by_model = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0})
        daily_data = defaultdict(lambda: {"input": 0, "output": 0})

        for r in records:
            provider = r.get("provider", "unknown")
            model = r.get("model", "unknown")
            input_t = r.get("inputTokens", 0)
            output_t = r.get("outputTokens", 0)
            cost = self.calculate_cost(provider, model, input_t, output_t)

            by_provider[provider]["input"] += input_t
            by_provider[provider]["output"] += output_t
            by_provider[provider]["calls"] += 1
            by_provider[provider]["cost"] += cost

            by_model[model]["input"] += input_t
            by_model[model]["output"] += output_t
            by_model[model]["calls"] += 1
            by_model[model]["cost"] += cost
            by_model[model]["tokens"] = (
                by_model[model]["input"] + by_model[model]["output"]
            )
            by_model[model]["provider"] = provider

            date = r.get("timestamp", "").split("T")[0]
            if date:
                daily_data[date]["input"] += input_t
                daily_data[date]["output"] += output_t

        # Build trend
        trend_labels = []
        trend_input = []
        trend_output = []
        for i in range(period - 1, -1, -1):
            date = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
            trend_labels.append((datetime.now() - timedelta(days=i)).strftime("%m/%d"))
            trend_input.append(daily_data.get(date, {}).get("input", 0))
            trend_output.append(daily_data.get(date, {}).get("output", 0))

        # Recent sessions
        sessions = defaultdict(
            lambda: {"calls": 0, "tokens": 0, "cost": 0, "model": ""}
        )
        for r in records:
            sid = r.get("sessionId", "unknown")
            sessions[sid]["calls"] += 1
            sessions[sid]["tokens"] += r.get("inputTokens", 0) + r.get(
                "outputTokens", 0
            )
            sessions[sid]["model"] = r.get("model", "unknown")
            sessions[sid]["session_id"] = sid
            sessions[sid]["cost"] += self.calculate_cost(
                r.get("provider", ""),
                r.get("model", ""),
                r.get("inputTokens", 0),
                r.get("outputTokens", 0),
            )

        return {
            "project": project,
            "period_days": period,
            "summary": {
                "total_input_tokens": total_input,
                "total_output_tokens": total_output,
                "total_tokens": total_input + total_output,
                "total_calls": total_calls,
                "total_cost_usd": round(
                    sum(
                        self.calculate_cost(
                            r.get("provider", ""),
                            r.get("model", ""),
                            r.get("inputTokens", 0),
                            r.get("outputTokens", 0),
                        )
                        for r in records
                    ),
                    4,
                ),
                "avg_latency_ms": round(total_latency / max(total_calls, 1))
                if total_calls > 0
                else 0,
            },
            "by_provider": dict(by_provider),
            "by_model": dict(by_model),
            "trend": {
                "labels": trend_labels,
                "inputTokens": trend_input,
                "outputTokens": trend_output,
            },
            "recent_sessions": list(sessions.values())[:10],
        }


def create_app(auth_token: str = ""):
    api = TokenAPI()

    if HAS_FLASK:
        app = Flask(__name__)

        if auth_token:

            @app.before_request
            def require_dashboard_auth():
                if is_authorized_request(request.headers.get("Authorization"), auth_token):
                    return None
                return Response(
                    "Authentication required",
                    status=401,
                    headers={"WWW-Authenticate": 'Basic realm="Forgewright Token Dashboard"'},
                )

        @app.route("/")
        def index():
            return send_file("../scripts/token-dashboard.html")

        @app.route("/dashboard")
        def dashboard():
            html_path = Path(__file__).parent / "token-dashboard.html"
            if html_path.exists():
                return send_file(html_path)
            return Response(
                "<html><body><h1>Dashboard not found</h1></body></html>",
                mimetype="text/html",
            )

        @app.route("/api/projects")
        def projects():
            return jsonify(api.list_projects())

        @app.route("/api/usage")
        def usage():
            project = request.args.get(
                "project", api.list_projects()[0] if api.list_projects() else ""
            )
            period = int(request.args.get("period", 7))
            return jsonify(api.get_usage(project, period))

        @app.route("/api/health")
        def health():
            return jsonify(
                {"status": "ok", "projects_tracked": len(api.list_projects())}
            )

        @app.route("/api/cursor/models")
        def cursor_models():
            """Get model usage stats from Cursor database."""
            cursor_reader = CursorDBReader()
            if not cursor_reader.is_available():
                return jsonify(
                    {
                        "error": "Cursor database not found",
                        "models": [],
                        "conversations": [],
                        "available": False,
                    }
                ), 404

            return jsonify(
                {
                    "models": cursor_reader.get_model_stats(),
                    "conversations": cursor_reader.get_conversations(),
                    "available": True,
                }
            )

        @app.route("/api/cursor/projects")
        def cursor_projects():
            """Get project stats from Cursor database."""
            cursor_reader = CursorDBReader()
            return jsonify(
                {
                    "projects": cursor_reader.get_projects(),
                    "available": cursor_reader.is_available(),
                }
            )

        @app.route("/api/unified/usage")
        def unified_usage():
            """Combined usage from all sources."""
            cursor_reader = CursorDBReader()
            project = request.args.get("project", "forgewright")
            period = int(request.args.get("period", 7))
            forgewright_data = api.get_usage(project, period)

            cursor_models_data = cursor_reader.get_model_stats()

            return jsonify(
                {
                    "forgewright": forgewright_data,
                    "cursor": {
                        "models": cursor_models_data,
                        "available": cursor_reader.is_available(),
                    },
                }
            )

        @app.route("/api/claude/sessions")
        def claude_sessions():
            """Get sessions from Claude Code telemetry."""
            claude_reader = ClaudeTelemetryReader()
            return jsonify(
                {
                    "sessions": claude_reader.get_sessions(),
                    "models": claude_reader.get_model_usage(),
                    "available": claude_reader.is_available(),
                }
            )

        @app.route("/api/claude/projects")
        def claude_projects():
            """Get projects from Claude Code telemetry."""
            claude_reader = ClaudeTelemetryReader()
            return jsonify(
                {
                    "projects": claude_reader.get_projects(),
                    "available": claude_reader.is_available(),
                }
            )

        @app.route("/api/unified/summary")
        def unified_summary():
            """Get unified summary across all platforms."""
            aggregator = UnifiedAggregator()
            return jsonify(aggregator.get_summary())

        return app
    else:
        return None


def run_basic_server(host: str, port: int, auth_token: str = ""):
    """Fallback to basic http.server."""
    import http.server
    import socketserver

    cursor_reader = CursorDBReader()
    claude_reader = ClaudeTelemetryReader()

    class Handler(http.server.SimpleHTTPRequestHandler):
        def _authorized(self) -> bool:
            if is_authorized_request(self.headers.get("Authorization"), auth_token):
                return True
            self.send_response(401)
            self.send_header(
                "WWW-Authenticate", 'Basic realm="Forgewright Token Dashboard"'
            )
            self.end_headers()
            self.wfile.write(b"Authentication required")
            return False

        def do_GET(self):
            if not self._authorized():
                return
            if self.path == "/api/projects":
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(api.list_projects()).encode())
            elif self.path.startswith("/api/usage"):
                import urllib.parse

                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                project = qs.get("project", [""])[0]
                period = int(qs.get("period", ["7"])[0])
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(api.get_usage(project, period)).encode())
            elif self.path == "/api/cursor/models":
                self.send_response(200 if cursor_reader.is_available() else 404)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "models": cursor_reader.get_model_stats(),
                            "conversations": cursor_reader.get_conversations(),
                            "available": cursor_reader.is_available(),
                        }
                    ).encode()
                )
            elif self.path == "/api/cursor/projects":
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "projects": cursor_reader.get_projects(),
                            "available": cursor_reader.is_available(),
                        }
                    ).encode()
                )
            elif self.path == "/api/unified/usage":
                import urllib.parse

                qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                project = qs.get("project", ["forgewright"])[0]
                forgewright_data = api.get_usage(project, 7)
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "forgewright": forgewright_data,
                            "cursor": {
                                "models": cursor_reader.get_model_stats(),
                                "available": cursor_reader.is_available(),
                            },
                        }
                    ).encode()
                )
            elif self.path == "/api/claude/sessions":
                self.send_response(200 if claude_reader.is_available() else 404)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "sessions": claude_reader.get_sessions(),
                            "models": claude_reader.get_model_usage(),
                            "available": claude_reader.is_available(),
                        }
                    ).encode()
                )
            elif self.path == "/api/claude/projects":
                self.send_response(200 if claude_reader.is_available() else 404)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "projects": claude_reader.get_projects(),
                            "available": claude_reader.is_available(),
                        }
                    ).encode()
                )
            elif self.path == "/api/unified/summary":
                aggregator = UnifiedAggregator()
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(aggregator.get_summary()).encode())
            elif self.path == "/api/health":
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "status": "ok",
                            "projects_tracked": len(api.list_projects()),
                            "cursor_available": cursor_reader.is_available(),
                            "claude_available": claude_reader.is_available(),
                        }
                    ).encode()
                )
            elif self.path == "/dashboard" or self.path == "/":
                self.send_response(200)
                self.send_header("Content-type", "text/html")
                self.end_headers()
                html_path = Path(__file__).parent / "token-dashboard.html"
                if html_path.exists():
                    self.wfile.write(html_path.read_bytes())
                else:
                    self.wfile.write(
                        b"<html><body><h1>Dashboard not found</h1></body></html>"
                    )
            else:
                super().do_GET()

        def log_message(self, format, *args):
            print(f"  {args[0]}")

    api = TokenAPI()

    with socketserver.TCPServer((host, port), Handler) as httpd:
        display_host = f"[{host}]" if ":" in host else host
        print("\n🚀 Token Usage API Server")
        print(f"   Dashboard: http://{display_host}:{port}/dashboard")
        print(f"   API:       http://{display_host}:{port}/api/usage")
        print(f"   Projects:  {len(api.list_projects())} tracked")
        print(
            f"   Cursor:   {'Available' if cursor_reader.is_available() else 'Not found'}"
        )
        print(
            f"   Claude:   {'Available' if claude_reader.is_available() else 'Not found'}"
        )
        print("\n   Press Ctrl+C to stop\n")
        httpd.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Token Usage API Server")
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Bind host (default: 127.0.0.1; non-loopback requires auth token env)",
    )
    parser.add_argument("--port", "-p", type=int, default=8080, help="Port to run on")
    args = parser.parse_args()
    auth_token = os.environ.get(DASHBOARD_AUTH_ENV, "").strip()
    try:
        validate_bind_policy(args.host, auth_token)
    except ValueError as error:
        parser.error(str(error))

    display_host = f"[{args.host}]" if ":" in args.host else args.host
    if HAS_FLASK:
        app = create_app(auth_token=auth_token)
        print("\n🚀 Token Usage API Server (Flask)")
        print(f"   Dashboard: http://{display_host}:{args.port}/dashboard")
        print(f"   API:       http://{display_host}:{args.port}/api/usage")
        print(f"   Projects:  {len(TokenAPI().list_projects())} tracked")
        print(f"   Auth:      {'Basic auth enabled' if auth_token else 'loopback-only'}")
        print("\n   Press Ctrl+C to stop\n")
        app.run(host=args.host, port=args.port, debug=False)
    else:
        run_basic_server(args.host, args.port, auth_token)

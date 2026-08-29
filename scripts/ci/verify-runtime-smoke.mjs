#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = new Set(process.argv.slice(2));
const evidenceIndex = process.argv.indexOf('--evidence');
const evidencePath = evidenceIndex === -1 ? undefined : process.argv[evidenceIndex + 1];
const live = args.has('--live');
const mcpOnly = args.has('--mcp-only');
const marker = 'FORGEWRIGHT_LIVE_SMOKE_OK';
const maxOutputBytes = 64 * 1024;
const timeoutMs = 15_000;

if (evidenceIndex !== -1 && !evidencePath) throw new Error('--evidence requires a path');
if (live === mcpOnly) throw new Error('select exactly one of --mcp-only or --live');

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Gemini API returned HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Gemini API returned no response body');
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxOutputBytes) throw new Error('Gemini API exceeded the output cap');
    chunks.push(value);
  }
  return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
}

async function runGeminiApiSmoke() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is required for the live provider smoke');
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
  const catalog = await fetchJson('https://generativelanguage.googleapis.com/v1beta/models', { headers });
  const configured = process.env.FORGEWRIGHT_LIVE_SMOKE_MODEL;
  const model = configured
    ? catalog.models?.find((candidate) => candidate.name === `models/${configured}`)
    : catalog.models?.find((candidate) => candidate.supportedGenerationMethods?.includes('generateContent') && /flash/i.test(candidate.name));
  if (!model?.name) throw new Error('Gemini API did not expose an eligible generateContent model');
  const response = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/${model.name}:generateContent`,
    { method: 'POST', headers, body: JSON.stringify({ contents: [{ parts: [{ text: `Return only ${marker}.` }] }], generationConfig: { maxOutputTokens: 16, temperature: 0 } }) },
  );
  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (!text.includes(marker)) throw new Error('Gemini API response did not contain the smoke marker');
  return { id: 'gemini-api', model: model.name.replace(/^models\//, ''), markerVerified: true };
}

async function runCodexSmoke() {
  const model = process.env.FORGEWRIGHT_LIVE_SMOKE_MODEL ?? 'gpt-5.6-terra';
  const directory = mkdtempSync(join(tmpdir(), 'forgewright-codex-smoke-'));
  const outputPath = join(directory, 'final.txt');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('codex', ['exec', '--ephemeral', '--model', model, '--sandbox', 'read-only', '--output-last-message', outputPath, '-'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
      let total = 0;
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Codex provider timed out')); }, timeoutMs);
      const observe = (chunk) => {
        total += chunk.byteLength;
        if (total > maxOutputBytes) { child.kill('SIGTERM'); reject(new Error('Codex provider exceeded the output cap')); }
      };
      child.stdout.on('data', observe);
      child.stderr.on('data', observe);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Codex provider exited ${code}`)); });
      child.stdin.end(`Return only ${marker}. Do not inspect files, call tools, or include any other text.`);
    });
    if (!readFileSync(outputPath, 'utf8').includes(marker)) throw new Error('Codex provider response did not contain the smoke marker');
    return { id: 'codex-cli', model, markerVerified: true };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function runMcpSmoke() {
  const build = join(root, 'mcp', 'build', 'index.js');
  const workspace = mkdtempSync(join(tmpdir(), 'forgewright-mcp-smoke-'));
  const trajectoryRoot = join(workspace, 'trajectory-ledgers');
  const trajectoryId = 'runtime-smoke-trajectory';
  const rawSecret = 'runtime-smoke-raw-secret';
  mkdirSync(join(workspace, '.forgewright'), { recursive: true });
  cpSync(
    join(root, '.forgewright', 'execution-policy.yaml'),
    join(workspace, '.forgewright', 'execution-policy.yaml'),
  );
  const child = spawn(process.execPath, [build], {
    cwd: workspace,
    env: {
      ...process.env,
      FORGEWRIGHT_MCP_LEASE_ROOT: join(workspace, 'leases'),
      FORGEWRIGHT_WORKSPACE: workspace,
      FORGEWRIGHT_TRAJECTORY_ROOT: trajectoryRoot,
      FORGEWRIGHT_TRAJECTORY_ID: trajectoryId,
      FORGEWRIGHT_SESSION_ID: 'runtime-smoke-session',
      FORGEWRIGHT_LIFECYCLE_SHUTDOWN_TIMEOUT_MS: '5000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  let exited = false;
  const pending = new Map();
  let nextId = 1;
  const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (const line of buffer.split('\n').slice(0, -1)) {
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) { pending.delete(message.id); resolve(message); }
    }
    buffer = buffer.includes('\n') ? buffer.slice(buffer.lastIndexOf('\n') + 1) : buffer;
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2048); });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => {
      exited = true;
      code === 0 ? resolve() : reject(new Error(`MCP process exited ${code}: ${stderr}`));
    });
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), timeoutMs);
    pending.set(id, (message) => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    const initialized = await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'forgewright-runtime-smoke', version: '1' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const tools = await call('tools/list', {});
    const current = await call('tools/call', {
      name: 'fw_get_current_phase',
      arguments: { secret: rawSecret },
    });
    if (initialized.error || tools.error || current.error || current.result?.isError) throw new Error(`MCP boundary rejected smoke call: ${stderr}`);
    const toolCount = tools.result?.tools?.length;
    if (!Number.isInteger(toolCount) || toolCount < 1) throw new Error('MCP tools/list returned no tools');
    child.stdin.end();
    await closed;

    const trajectoryDirectory = join(trajectoryRoot, trajectoryId);
    const events = readdirSync(trajectoryDirectory)
      .filter((name) => name.endsWith('.event.json'))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(trajectoryDirectory, name), 'utf8')));
    const kinds = events.map((event) => event.kind);
    for (const requiredKind of [
      'trajectory.opened',
      'scope.opened',
      'operation.started',
      'operation.settled',
      'scope.closed',
      'finalization.started',
      'finalization.receipt',
      'trajectory.terminal',
    ]) {
      if (!kinds.includes(requiredKind)) throw new Error(`MCP trajectory missed ${requiredKind}`);
    }
    const terminal = events.at(-1);
    const receipt = events.at(-2);
    if (terminal?.kind !== 'trajectory.terminal' || receipt?.kind !== 'finalization.receipt') {
      throw new Error('MCP trajectory did not seal receipt then terminal');
    }
    if (terminal.payload?.outcome !== 'completed' || terminal.payload?.quiescence !== 'confirmed') {
      throw new Error('MCP trajectory terminal did not confirm completed quiescence');
    }
    if (terminal.payload?.receiptEventId !== receipt.eventId) {
      throw new Error('MCP trajectory terminal is not bound to its receipt');
    }
    if (JSON.stringify(events).includes(rawSecret)) {
      throw new Error('MCP trajectory persisted raw tool arguments');
    }
    return {
      protocol: initialized.result?.protocolVersion,
      toolCount,
      nonMutatingTool: 'fw_get_current_phase',
      trajectory: {
        eventCount: events.length,
        terminalOutcome: terminal.payload.outcome,
        quiescence: terminal.payload.quiescence,
        rawArgumentsPersisted: false,
      },
    };
  } finally {
    clearTimeout(timer);
    if (!exited) child.kill('SIGTERM');
    rmSync(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const mcp = await runMcpSmoke();
  const receipt = { schemaVersion: 1, status: 'pass', mcp };
  if (live) {
    if (process.env.FORGEWRIGHT_LIVE_SMOKE !== '1') throw new Error('set FORGEWRIGHT_LIVE_SMOKE=1 to authorize a live provider call');
    const provider = process.env.FORGEWRIGHT_LIVE_SMOKE_PROVIDER ?? 'codex';
    if (provider === 'codex') receipt.provider = await runCodexSmoke();
    else if (provider === 'gemini-api') receipt.provider = await runGeminiApiSmoke();
    else throw new Error(`unsupported live smoke provider: ${provider}`);
  }
  const output = `${JSON.stringify(receipt, null, 2)}\n`;
  if (evidencePath) writeFileSync(evidencePath, output, { encoding: 'utf8', mode: 0o600 });
  else process.stdout.write(output);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });

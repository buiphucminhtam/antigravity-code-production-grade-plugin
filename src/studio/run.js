#!/usr/bin/env node

/**
 * Forgewright Studio - Standalone Server
 *
 * Real-time pipeline monitoring WebSocket server
 *
 * Usage:
 *   node src/studio/run.js              # Default port 7892 (avoids conflict with extension)
 *   node src/studio/run.js --port 7891  # Use port 7891
 *   node src/studio/run.js --demo       # Send demo events
 *
 * Requires:
 *   - Node.js 22+
 *   - npm install (ws is included as dependency)
 */

const WebSocket = require("ws");
const { randomUUID } = require("crypto");

const DEFAULT_PORT = 7892; // Use 7892 to avoid conflict with Cursor extension (7891)
const PORT = process.env.STUDIO_PORT 
  ? parseInt(process.env.STUDIO_PORT, 10) 
  : (process.argv.includes("--port") 
      ? parseInt(process.argv[process.argv.indexOf("--port") + 1], 10) 
      : DEFAULT_PORT);
const DEMO_MODE = process.argv.includes("--demo");

// Event types
const EVENTS = {
  PIPELINE_START: "pipeline:start",
  PIPELINE_PROGRESS: "pipeline:progress",
  PIPELINE_COMPLETE: "pipeline:complete",
  STATS_UPDATE: "stats:update",
  MEMORY_TRACE: "memory:trace",
  ERROR_THROW: "error:throw",
};

// Session management
let currentSession = null;
const clients = new Map();

// Create WebSocket server
let wss;
try {
  wss = new WebSocket.Server({ port: PORT });
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.log(`\n⚠️  Port ${PORT} is already in use.`);
    console.log(`    The Forgewright extension may have started Studio automatically.`);
    console.log(`    Or use: node src/studio/run.js --port ${PORT === 7892 ? 7893 : 7892}\n`);
    process.exit(1);
  }
  throw err;
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Forgewright Studio                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  🎯 WebSocket: ws://localhost:${PORT.toString().padEnd(27)}║
║                                                              ║
║  Status: ${"Running".padEnd(48)}║
║                                                              ║
║  Note: Connect from browser using StudioApp React component  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

// Broadcast to all subscribed clients
function broadcast(event) {
  for (const [clientId, client] of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (!client.sessionId || client.sessionId === event.sessionId) {
        client.ws.send(JSON.stringify({
          event: event.type,
          data: event,
        }));
      }
    }
  }
}

// Handle connections
wss.on("connection", (ws) => {
  const clientId = randomUUID();
  clients.set(clientId, { ws, sessionId: null });

  console.log(`[Studio] Client connected: ${clientId}`);

  ws.send(JSON.stringify({
    event: "connected",
    data: { clientId, serverTime: Date.now() },
  }));

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.action === "subscribe") {
        clients.get(clientId).sessionId = msg.sessionId || null;
        console.log(`[Studio] Client ${clientId} subscribed to: ${msg.sessionId || "all"}`);
      } else if (msg.action === "unsubscribe") {
        clients.get(clientId).sessionId = null;
      }
    } catch (e) {
      console.error("[Studio] Failed to parse message:", e);
    }
  });

  ws.on("close", () => {
    clients.delete(clientId);
    console.log(`[Studio] Client disconnected: ${clientId}`);
  });
});

// Helper functions for emitting events
function emitSessionStart(mode) {
  currentSession = {
    id: randomUUID(),
    mode,
    startTime: Date.now(),
  };
  broadcast({
    type: EVENTS.PIPELINE_START,
    sessionId: currentSession.id,
    mode,
    timestamp: Date.now(),
  });
  return currentSession.id;
}

function emitProgress(phase, skill, status, progress) {
  if (!currentSession) return;
  broadcast({
    type: EVENTS.PIPELINE_PROGRESS,
    sessionId: currentSession.id,
    phase,
    skill,
    status,
    progress,
    timestamp: Date.now(),
  });
}

function emitStats(tokens, cost, duration) {
  if (!currentSession) return;
  broadcast({
    type: EVENTS.STATS_UPDATE,
    sessionId: currentSession.id,
    tokens,
    cost,
    duration,
    timestamp: Date.now(),
  });
}

function emitComplete(score) {
  if (!currentSession) return;
  broadcast({
    type: EVENTS.PIPELINE_COMPLETE,
    sessionId: currentSession.id,
    duration: Date.now() - currentSession.startTime,
    score,
    timestamp: Date.now(),
  });
  currentSession = null;
}

// Demo mode
if (DEMO_MODE) {
  console.log("\n[Studio] Demo mode - sending sample events...\n");

  const sessionId = emitSessionStart("Full Build");
  console.log(`[Studio] Session: ${sessionId}`);

  setTimeout(() => emitProgress("DEFINE", "Business Analyst", "running", 10), 1000);
  setTimeout(() => emitProgress("DEFINE", "Product Manager", "running", 30), 2000);
  setTimeout(() => emitProgress("DEFINE", "Solution Architect", "complete", 40), 3000);
  setTimeout(() => emitProgress("BUILD", "Backend Engineer", "running", 50), 4000);
  setTimeout(() => { 
    emitStats(15000, 0.25, 4000); 
    emitProgress("BUILD", "Frontend Engineer", "running", 70); 
  }, 5000);
  setTimeout(() => emitProgress("BUILD", "QA Engineer", "complete", 85), 6000);
  setTimeout(() => emitProgress("HARDEN", "Security Engineer", "complete", 95), 7000);
  setTimeout(() => emitComplete(87), 8000);

  console.log("[Studio] Demo events scheduled. Connect a WebSocket client to see them.\n");
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n[Studio] Shutting down...");
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n[Studio] Shutting down...");
  wss.close();
  process.exit(0);
});

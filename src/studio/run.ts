/**
 * Forgewright Studio - Standalone Application
 *
 * Real-time pipeline monitoring dashboard
 *
 * Usage:
 *   npx ts-node src/studio/run.ts
 *   npx ts-node src/studio/run.ts --demo
 *
 * Requires:
 *   - Node.js 22+
 *   - npm install (for dependencies)
 */

import { createWebSocketServer } from "./server/wsServer.js";
import { createStudioEventEmitter } from "./server/eventEmitter.js";

const PORT = parseInt(process.env.STUDIO_PORT || "7891", 10);
const DEMO_MODE = process.argv.includes("--demo");

// Start WebSocket Server
const wsServer = createWebSocketServer(PORT);

// Start Event Emitter and connect to WebSocket
const eventEmitter = createStudioEventEmitter();
eventEmitter.setWebSocketServer(wsServer);

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                   Forgewright Studio                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  🎯 WebSocket: ws://localhost:${PORT.toString().padEnd(26)}║
║                                                              ║
║  Status: ${"Running".padEnd(48)}║
║                                                              ║
║  Note: Connect from browser using StudioApp React component  ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

if (DEMO_MODE) {
  console.log("[Studio] Demo mode enabled - sending sample events...\n");
  
  // Start a session
  const sessionId = eventEmitter.startSession("Full Build");
  console.log(`[Studio] Session started: ${sessionId}`);

  // Send demo events with delays
  setTimeout(() => {
    eventEmitter.progress("DEFINE", "Business Analyst", "running", 10);
  }, 1000);

  setTimeout(() => {
    eventEmitter.progress("DEFINE", "Product Manager", "running", 30);
  }, 2000);

  setTimeout(() => {
    eventEmitter.progress("DEFINE", "Solution Architect", "complete", 40);
  }, 3000);

  setTimeout(() => {
    eventEmitter.progress("BUILD", "Backend Engineer", "running", 50);
  }, 4000);

  setTimeout(() => {
    eventEmitter.stats(15000, 0.25, 4000);
  }, 5000);

  setTimeout(() => {
    eventEmitter.progress("BUILD", "Frontend Engineer", "running", 70);
  }, 6000);

  setTimeout(() => {
    eventEmitter.progress("BUILD", "QA Engineer", "complete", 85);
  }, 7000);

  setTimeout(() => {
    eventEmitter.complete(87);
  }, 8000);

  console.log("[Studio] Demo events scheduled. Check WebSocket client to see them.");
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[Studio] Shutting down...");
  eventEmitter.destroy();
  await wsServer.shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[Studio] Shutting down...");
  eventEmitter.destroy();
  await wsServer.shutdown();
  process.exit(0);
});

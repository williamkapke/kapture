#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { openSync } from 'fs';
import { tmpdir } from 'os';
import { ensureServer } from './bridge-lib.js';

process.title = 'Kapture MCP Bridge';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCPWebSocketBridge = require('mcp2websocket');

const HOST = '127.0.0.1';
const PORT = 61822;

// Synthetic JSON-RPC id for the replayed initialize request. Client ids are
// numbers (or client-chosen strings), so this never collides.
const REPLAY_INITIALIZE_ID = 'kapture-bridge-replay-initialize';

/**
 * mcp2websocket bridge that replays the MCP initialize handshake when the
 * WebSocket reconnects (e.g. after a server restart). The server creates a
 * fresh MCP connection per socket, so without the replay a reconnected bridge
 * shows up uninitialized and without clientInfo. The replayed initialize uses
 * a synthetic request id and its response is swallowed so the stdio client
 * never sees a reply it didn't ask for.
 */
class ReplayingMCPWebSocketBridge extends MCPWebSocketBridge {
  private initializeRequest: any = null;
  private initializedNotification: any = null;
  private everConnected = false;

  constructor(url: string, options?: any) {
    super(url, options);
  }

  sendToWebSocket(message: any): void {
    if (message?.method === 'initialize' && message.id !== REPLAY_INITIALIZE_ID) {
      this.initializeRequest = message;
    } else if (message?.method === 'notifications/initialized') {
      this.initializedNotification = message;
    }
    super.sendToWebSocket(message);
  }

  // mcp2websocket calls this on every WebSocket 'open'
  flushMessageQueue(): void {
    if (this.everConnected && this.initializeRequest) {
      super.sendToWebSocket({ ...this.initializeRequest, id: REPLAY_INITIALIZE_ID });
      if (this.initializedNotification) {
        super.sendToWebSocket(this.initializedNotification);
      }
    }
    this.everConnected = true;
    super.flushMessageQueue();
  }

  sendToStdout(message: any): void {
    if (message?.id === REPLAY_INITIALIZE_ID) {
      return; // response to the replayed initialize
    }
    super.sendToStdout(message);
  }
}
const serverPath = join(__dirname, 'index.js');
const logPath = join(tmpdir(), 'kapture-server.log');

// Best-effort: spawn a standalone server as a detached child. Keeps the
// shared-server model (multiple MCP clients, one server, same browser tabs)
// when the host can keep a detached child alive. See issue #7.
function spawnDetachedServer() {
  // Capture the child's output to a log file, never our stdout (which is the
  // MCP JSON-RPC channel), so a failed spawn is diagnosable rather than silent.
  const log = openSync(logPath, 'a');
  const serverProcess = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: ['ignore', log, log],
    // If this host runs us under Electron's Node (e.g. Claude Desktop),
    // process.execPath is the Electron binary; ELECTRON_RUN_AS_NODE makes the
    // child run as plain Node instead of launching the desktop app. It is a
    // no-op under a real node. Hosts that still can't keep the child alive fall
    // through to the in-process path in ensureServer.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  serverProcess.on('error', (error) => {
    console.error('Failed to spawn Kapture server:', error);
  });
  serverProcess.unref();
}

// Host the server inside this process. The module auto-starts only as the
// process entrypoint, so importing it here does not start a second listener;
// we call its exported startServer() explicitly.
async function startServerInProcess() {
  const { startServer } = await import('./index.js');
  await startServer();
}

async function main() {
  // Make sure a server is listening: reuse an already-running one, else spawn a
  // detached child, else host it in-process. The in-process fallback is the fix
  // for issue #13 ("Unable to connect to extension server"): under hosts whose
  // bundled Node runtime cannot keep a detached child alive (e.g. Claude
  // Desktop), the spawned server never binds the port, and the bridge used to
  // give up with exit(1). console.error (stderr) is safe; stdout is the MCP
  // channel.
  const outcome = await ensureServer({
    host: HOST,
    port: PORT,
    spawnDetached: spawnDetachedServer,
    startInProcess: startServerInProcess,
    log: (message) => console.error(message),
  });

  if (outcome === 'failed') {
    console.error(
      `Kapture server never bound ${HOST}:${PORT}. See ${logPath} for details.`
    );
    process.exit(1);
  }

  const bridge = new ReplayingMCPWebSocketBridge(`ws://${HOST}:${PORT}/mcp`, {});
  bridge.start();
  // Keep the process alive
  process.stdin.resume();
}

main().catch((error) => {
  console.error('Failed to start bridge:', error);
  process.exit(1);
});

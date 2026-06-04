#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { openSync } from 'fs';
import { tmpdir } from 'os';
import { probe, waitForPort } from './bridge-lib.js';

process.title = 'Kapture MCP Bridge';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MCPWebSocketBridge = require('mcp2websocket');

const HOST = '127.0.0.1';
const PORT = 61822;
const serverPath = join(__dirname, 'index.js');
const logPath = join(tmpdir(), 'kapture-server.log');

async function main() {
  // Probe before spawning: if a server (or an external supervisor) is already
  // listening, skip the spawn entirely so the bridge is idempotent and tolerant
  // of environments where the detached child can't take (e.g. Claude Desktop's
  // built-in Node runtime). See issue #7.
  if (!(await probe(HOST, PORT))) {
    // Capture the child's stderr to a log file instead of discarding it, so a
    // failed spawn is diagnosable rather than silent.
    const log = openSync(logPath, 'a');
    const serverProcess = spawn(process.execPath, [serverPath], {
      detached: true,
      stdio: ['ignore', log, log]
    });
    serverProcess.on('error', (error) => {
      console.error('Failed to spawn Kapture server:', error);
    });
    serverProcess.unref();
  }

  // Wait for the server to actually bind the port instead of a fixed delay,
  // and fail loudly if it never comes up rather than hanging on the WebSocket
  // connect (which surfaces to the client as a silent ~60s timeout).
  if (!(await waitForPort(HOST, PORT))) {
    console.error(
      `Kapture server never bound ${HOST}:${PORT}. See ${logPath} for details.`
    );
    process.exit(1);
  }

  const bridge = new MCPWebSocketBridge(`ws://${HOST}:${PORT}/mcp`, {});
  bridge.start();
  // Keep the process alive
  process.stdin.resume();
}

main().catch((error) => {
  console.error('Failed to start bridge:', error);
  process.exit(1);
});

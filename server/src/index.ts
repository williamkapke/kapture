#!/usr/bin/env node

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { TabRegistry } from './tab-registry.js';
import { BrowserWebSocketManager } from './browser-websocket-manager.js';
import { BrowserCommandHandler } from './browser-command-handler.js';
import { MCPServerManager } from './mcp-server-manager.js';
import { logger } from './logger.js';
import { ResourceHandler } from './resource-handler.js';
import { ToolHandler } from './tool-handler.js';
import { checkIfPortInUse } from './port-check.js';
import { detectAssistants, configureAssistants } from './assistant-manager.js';


// ========================================================================
// Constants and Configuration
// ========================================================================

// Set process title for better identification
process.title = 'Kapture MCP Server';

// Fixed port for all connections
const PORT = 61822;

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ========================================================================
// Core Component Initialization
// ========================================================================

// Initialize registries and managers
const tabRegistry = new TabRegistry();
const wss = new WebSocketServer({ noServer: true });
const browserWebSocketManager = new BrowserWebSocketManager(wss, tabRegistry);
const commandHandler = new BrowserCommandHandler(browserWebSocketManager, tabRegistry);

// Connect browser responses to command handler
browserWebSocketManager.setResponseHandler((response) => {
  commandHandler.handleCommandResponse(response);
});

// ========================================================================
// MCP Handlers Initialization
// ========================================================================

// Initialize handlers
const toolHandler = new ToolHandler(commandHandler, tabRegistry);
const resourceHandler = new ResourceHandler(tabRegistry, toolHandler);

// ========================================================================
// MCP Server Manager Initialization
// ========================================================================

// Initialize MCP Server Manager with all dependencies
const mcpServerManager = new MCPServerManager(
  browserWebSocketManager,
  tabRegistry,
  commandHandler,
  resourceHandler,
  toolHandler
);

// ========================================================================
// HTTP Server Setup
// ========================================================================

// Tab-scoped commands exposed over HTTP as POST /tab/{tabId}/{command}
// (evaluate is gated per-tab by the "Allow JavaScript Execution" toggle,
// enforced in BrowserCommandHandler and in the extension)
const HTTP_TAB_COMMANDS = new Set([
  'navigate', 'back', 'forward', 'reload', 'show',
  'click', 'hover', 'focus', 'blur', 'fill', 'select', 'keypress', 'scroll',
  'type', 'insertText', 'clear', 'evaluate', 'compose',
  'network_monitor', 'network_requests', 'network_body'
]);

function readJsonBody(req: import('http').IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Execute an MCP tool for an HTTP request and write the JSON response.
 * Waits for the command to complete (same timeouts as the MCP tools).
 */
async function handleHttpToolCall(res: import('http').ServerResponse, name: string, args: any): Promise<void> {
  try {
    const result = await toolHandler.callTool(name, args);
    const text = result.content[0].text;
    let status = 200;
    if (result.isError) {
      const message = JSON.parse(text)?.error?.message || '';
      status = message.includes('not found') ? 404 : 500;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(text);
  } catch (error: any) {
    // callTool throws McpError on input validation failures; drop its
    // "MCP error -32602: " message prefix for the HTTP response
    const message = error.message.replace(/^MCP error -?\d+: /, '');
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }
}

const httpServer = createServer(async (req, res) => {
  // Enable CORS for all endpoints
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    // Allow requests from public (https) pages to this local server (Chrome Private Network Access)
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.writeHead(200);
    res.end();
    return;
  }

  // Root - send browsers to the hosted dashboard
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(302, { Location: 'https://williamkapke.github.io/kapture/clients.html' });
    res.end();
    return;
  }

  // Connected MCP clients - server discovery and status
  if (req.url === '/clients' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });

    const connections = mcpServerManager.getConnectionInfo();
    res.end(JSON.stringify(connections));
    return;
  }

  // Serve test.html
  if (req.url && req.url.startsWith('/test.html') && req.method === 'GET') {
    try {
      const testPath = join(__dirname, '..', 'test.html');
      const content = await readFile(testPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (error) {
      logger.error('Error serving test.html:', error);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('test.html not found');
    }
    return;
  }

  // Serve welcome.html
  if (req.url === '/welcome' && req.method === 'GET') {
    try {
      const welcomePath = join(__dirname, '..', 'static', 'welcome.html');
      const content = await readFile(welcomePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (error) {
      logger.error('Error serving welcome.html:', error);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('welcome.html not found');
    }
    return;
  }

  // Handle /assistants endpoint
  if (req.url === '/assistants' && req.method === 'GET') {
    try {
      const assistants = detectAssistants();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(assistants));
    } catch (error) {
      logger.error('Error detecting assistants:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to detect assistants' }));
    }
    return;
  }

  // Handle /assistants/configure endpoint
  if (req.url === '/assistants/configure' && req.method === 'POST') {
    try {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', () => {
        try {
          const assistantsToConfig = JSON.parse(body);
          const results = configureAssistants(assistantsToConfig);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(results));
        } catch (error: any) {
          logger.error('Error configuring assistants:', error);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
    } catch (error) {
      logger.error('Error handling configure request:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to configure assistants' }));
    }
    return;
  }

  // POST /tabs - open a new tab (waits for it to connect)
  if (req.url === '/tabs' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      await handleHttpToolCall(res, 'new_tab', body);
    } catch (error: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // POST /tab/{tabId}/{command} - execute a tab command (waits for completion)
  if (req.url && req.method === 'POST') {
    const match = req.url.match(/^\/tab\/([^/]+)\/([^/?]+)$/);
    if (match && HTTP_TAB_COMMANDS.has(match[2])) {
      try {
        const body = await readJsonBody(req);
        await handleHttpToolCall(res, match[2], { ...body, tabId: decodeURIComponent(match[1]) });
      } catch (error: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
  }

  // DELETE /tab/{tabId} - close the tab
  if (req.url && req.method === 'DELETE') {
    const match = req.url.match(/^\/tab\/([^/?]+)$/);
    if (match) {
      await handleHttpToolCall(res, 'close', { tabId: decodeURIComponent(match[1]) });
      return;
    }
  }

  // All other endpoints delegate to resource handler
  if (req.url && req.method === 'GET') {
    try {
      // Convert HTTP URL to kapture:// URI
      let kaptureUri = req.url.substring(1); // Remove leading slash
      const isScreenshotView = kaptureUri.includes('/screenshot/view')

      // Special case for tabs endpoint
      if (kaptureUri === 'tabs') {
        kaptureUri = 'kapture://tabs';
      } else if (kaptureUri.startsWith('tab/')) {
        kaptureUri = 'kapture://' + kaptureUri.replace('/screenshot/view', '/screenshot');
      } else {
        // Unknown endpoint
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }
      const { isError, contents } = await resourceHandler.readResource(kaptureUri);

      // Special handling for screenshot/view endpoint
      if (!isError && isScreenshotView) {
        // Send image instead of JSON
        const content1 = contents[1];
        const imageBuffer = Buffer.from(content1.blob, 'base64');
        res.writeHead(200, { 'Content-Type': content1.mimeType });
        res.end(imageBuffer);
      }
      else {
        let result = contents[0].text;
        if(!isError && kaptureUri.includes('/screenshot')) {
          // move the image data to the first object
          const reslutObj = JSON.parse(contents[0].text);
          result = JSON.stringify({
            ...reslutObj,
            mimeType: contents[1].mimeType,
            data: contents[1].blob
          });
        }
        // Regular resource endpoints
        res.writeHead(200, {'Content-Type': 'application/json'});
        res.end(result);
      }
    } catch (error: any) {
      logger.error('Error handling HTTP endpoint:', error);
      res.writeHead(error.message.includes('not found') ? 404 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // 404 for non-GET methods
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// HTTP server error handling
httpServer.on('error', (error) => {
  logger.error('HTTP server error:', error);
  process.exit(1);
});

// ========================================================================
// WebSocket Setup
// ========================================================================

// Handle WebSocket upgrade requests
httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

// Route WebSocket connections
wss.on('connection', (ws, request) => {
  const url = request.url || '';

  if (url === '/mcp') {
    // MCP client connection
    mcpServerManager.connectWebSocket(ws).catch(error => {
      logger.error('Failed to connect MCP WebSocket:', error);
      ws.close();
    });
  }
  // Browser extension connections are handled automatically by browserWebSocketManager
});

// ========================================================================
// Server Startup
// ========================================================================

/**
 * Start the HTTP server and log available endpoints
 */
async function startServer() {
  await checkIfPortInUse(PORT);

  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log('='.repeat(70));
    console.log('Kapture MCP Server Started');
    console.log();
    console.log('HTTP Endpoints:');
    console.log(`  MCP clients: http://127.0.0.1:${PORT}/clients`);
    console.log(`  Resources: http://127.0.0.1:${PORT}/tabs`);
    console.log(`  Tab info: http://127.0.0.1:${PORT}/tab/{tabId}`);
    console.log(`  Console: http://127.0.0.1:${PORT}/tab/{tabId}/console`);
    console.log(`  Screenshot: http://127.0.0.1:${PORT}/tab/{tabId}/screenshot`);
    console.log(`  View image: http://127.0.0.1:${PORT}/tab/{tabId}/screenshot/view`);
    console.log(`  Elements: http://127.0.0.1:${PORT}/tab/{tabId}/elements`);
    console.log(`  Point query: http://127.0.0.1:${PORT}/tab/{tabId}/elementsFromPoint`);
    console.log(`  DOM: http://127.0.0.1:${PORT}/tab/{tabId}/dom`);
    console.log(`  Commands: POST http://127.0.0.1:${PORT}/tab/{tabId}/{command}`);
    console.log(`  New tab: POST http://127.0.0.1:${PORT}/tabs`);
    console.log(`  Close tab: DELETE http://127.0.0.1:${PORT}/tab/{tabId}`);
    console.log('='.repeat(70));
  });
}

// ========================================================================
// Shutdown Handling
// ========================================================================

process.on('SIGINT', () => {
  logger.log('\nReceived SIGINT - shutting down gracefully...');

  // Clean up in reverse order of initialization
  commandHandler.cleanup();
  browserWebSocketManager.shutdown();

  httpServer.close(() => {
    logger.log('Server shutdown complete');
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.error('Shutdown timeout - forcing exit');
    process.exit(0);
  }, 5000);
});

// ========================================================================
// Start the server
// ========================================================================

startServer();

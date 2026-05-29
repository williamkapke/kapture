#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { WebSocket } from 'ws';

process.title = 'Kapture Setup';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const localhost_welcome = 'http://127.0.0.1:61822/welcome';

async function setup() {
  console.log('Setup Server...');
  // Launch the server silently
  const serverPath = join(__dirname, 'index.js');
  const serverProcess = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore'
  });

  serverProcess.unref();

  // Wait for server to start
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Connect as an MCP client
  // @ts-ignore - WebSocket type mismatch
  globalThis.WebSocket = WebSocket;

  const client = new Client({
    name: 'kapture-setup',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  try {

    const transport = new WebSocketClientTransport(new URL('ws://127.0.0.1:61822/mcp'));
    await client.connect(transport);

    // Keep looking for the welcome tab
    let welcomeTabId = null;
    const maxAttempts = 30; // 30 seconds timeout
    let attempts = 0;

    while (!welcomeTabId && attempts < maxAttempts) {
      try {
        // List tabs to find the welcome tab
        const tabsResult = await client.callTool({
          name: 'list_tabs',
          arguments: {}
        });

        if (tabsResult && tabsResult.content && Array.isArray(tabsResult.content)) {
          // The content is an array of text blocks
          const tabsContent = tabsResult.content[0];
          if (tabsContent && tabsContent.type === 'text') {
            const response = JSON.parse(tabsContent.text);
            const tabs = response.tabs || [];

            // Find the welcome tab
            for (const tab of tabs) {
              const url = tab.url || '';
              const local_welcome_url = url.includes(localhost_welcome);

              //https://williamkapke.github.io/kapture/welcome
              const public_welcome_url = url.includes('/kapture/welcome');
              if (local_welcome_url || public_welcome_url) {
                console.log('Found welcome tab:', tab.tabId);
                welcomeTabId = tab.tabId;
                break;
              }
            }
          }
        }
      } catch (error) {
        // Ignore errors and keep trying
      }

      if (!welcomeTabId) {
        process.stdout.write('.');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        attempts++;
      }
    }

    if (welcomeTabId) {
      console.log('\nNavigating to welcome page...');
      await client.callTool({name: 'navigate', arguments: {tabId: welcomeTabId, url: localhost_welcome}});
      console.log('\nShowing welcome page...');
      await client.callTool({name: 'show', arguments: {tabId: welcomeTabId}});
    }
    console.log(`👉 Continue at ${localhost_welcome}`);

    // Exit the process
    process.exit(0);
  } catch (error) {
    // no op
    console.log('\n⚠️⚠️⚠️');
  }
  finally {
    // Close the client connection
    await client.close();
  }
}

// Run setup
setup().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

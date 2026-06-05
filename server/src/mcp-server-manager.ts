import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebSocketTransport } from './websocket-transport.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocket } from 'ws';
import { logger } from './logger.js';
import { TabRegistry } from './tab-registry.js';
import { BrowserWebSocketManager } from './browser-websocket-manager.js';
import { BrowserCommandHandler } from './browser-command-handler.js';
import { baseResources, createTabResources } from './yaml-loader.js';
import type { ResourceHandler } from './resource-handler.js';
import type { ToolHandler } from './tool-handler.js';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple paths to find package.json
let packageJson: any = { name: 'kapture-mcp', version: 'unknown' };
const possiblePaths = [
  join(__dirname, '../../package.json'), // Development path
  join(__dirname, '../package.json'),    // Compiled distribution path
  join(__dirname, 'package.json'),       // Same directory (edge case)
];

for (const path of possiblePaths) {
  if (existsSync(path)) {
    try {
      packageJson = JSON.parse(readFileSync(path, 'utf-8'));
      break;
    } catch (error) {
      // Continue to next path
    }
  }
}

const SERVER_NAME = packageJson.name;
const SERVER_VERSION = packageJson.version;
const SERVER_INFO = {
  name: SERVER_NAME,
  version: SERVER_VERSION
};

interface MCPConnection {
  id: string;
  server: Server;
  type: 'websocket';
  clientInfo?: { name?: string; version?: string };
  initialized: boolean;
}

export class MCPServerManager {
  private connections: Map<string, MCPConnection> = new Map();
  private dynamicTabResources: Map<string, any> = new Map();

  constructor(
    private browserWebSocketManager: BrowserWebSocketManager,
    private tabRegistry: TabRegistry,
    private commandHandler: BrowserCommandHandler,
    private resourceHandler: ResourceHandler,
    private toolHandler: ToolHandler
  ) {
    // Set up tab callbacks
    this.setupTabCallbacks();
  }

  private setupTabCallbacks(): void {
    // Tab connect callback
    this.tabRegistry.setConnectCallback(async (tabId: string) => {
      const tab = this.tabRegistry.get(tabId);
      logger.log(`New ${tab?.browser} tab: ${tabId}`);
      const tabTitle = tab?.title || `Tab ${tabId}`;

      this.updateTabResources(tabId, tabTitle);

      // Send notifications to all initialized connections
      await this.notifyAllConnections(async (connection) => {
        await connection.server.notification({
          method: 'notifications/resources/list_changed',
          params: {}
        });
      });

      await this.sendTabListChangeNotification();
    });

    // Tab update callback
    this.tabRegistry.setUpdateCallback(async (tabId: string) => {
      logger.log(`Tab updated: ${tabId}`);

      if (this.dynamicTabResources.has(tabId)) {
        const tab = this.tabRegistry.get(tabId);
        const tabTitle = tab?.title || `Tab ${tabId}`;

        this.updateTabResources(tabId, tabTitle);

        await this.notifyAllConnections(async (connection) => {
          await connection.server.notification({
            method: 'notifications/resources/list_changed',
            params: {}
          });
        });
      }

      await this.sendTabListChangeNotification();
    });

    // Tab disconnect callback
    this.tabRegistry.setDisconnectCallback(async (tabId: string) => {
      // Remove dynamic resources
      this.dynamicTabResources.delete(tabId);
      this.dynamicTabResources.delete(`${tabId}/console`);
      this.dynamicTabResources.delete(`${tabId}/screenshot`);
      this.dynamicTabResources.delete(`${tabId}/elementsFromPoint`);
      this.dynamicTabResources.delete(`${tabId}/dom`);
      this.dynamicTabResources.delete(`${tabId}/elements`);

      // Send notifications to all initialized connections
      await this.notifyAllConnections(async (connection) => {
        await connection.server.notification({
          method: 'notifications/resources/list_changed',
          params: {}
        });

        await connection.server.notification({
          method: 'kapture/tab_disconnected',
          params: {
            tabId,
            timestamp: Date.now()
          }
        });
      });

      await this.sendTabListChangeNotification();
    });

    // Set up console log handler
    this.browserWebSocketManager.setConsoleLogHandler(async (tabId: string, logEntry: any) => {
      await this.notifyAllConnections(async (connection) => {
        await connection.server.notification({
          method: 'kapture/console_log',
          params: {
            tabId,
            logEntry,
            timestamp: Date.now()
          }
        });
      });
    });
  }

  private updateTabResources(tabId: string, tabTitle: string): void {
    const tabResources = createTabResources(tabId, tabTitle);

    // Add all resources for this tab
    for (const [key, resource] of tabResources) {
      this.dynamicTabResources.set(key, resource);
    }
  }

  private async notifyAllConnections(handler: (connection: MCPConnection) => Promise<void>): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const connection of this.connections.values()) {
      if (connection.initialized) {
        promises.push(
          handler(connection).catch(error => {
            logger.error(`Failed to notify connection ${connection.id}:`, error);
          })
        );
      }
    }

    await Promise.all(promises);
  }

  private async sendTabListChangeNotification(): Promise<void> {
    const tabs = this.tabRegistry.getAll().map(tab => ({
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      connectedAt: tab.connectedAt,
      lastPing: tab.lastPing,
      domSize: tab.domSize,
      fullPageDimensions: tab.fullPageDimensions,
      viewportDimensions: tab.viewportDimensions,
      scrollPosition: tab.scrollPosition,
      pageVisibility: tab.pageVisibility
    }));

    await this.notifyAllConnections(async (connection) => {
      await connection.server.notification({
        method: 'kapture/tabs_changed',
        params: {
          tabs,
          timestamp: Date.now()
        }
      });
    });
  }

  private createMCPServer(connectionId: string): Server {
    const server = new Server(
      SERVER_INFO,
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Initialize handler
    server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const connection = this.connections.get(connectionId);
      if (!connection) {
        throw new Error('Connection not found');
      }

      if (request.params.clientInfo) {
        connection.clientInfo = request.params.clientInfo;
        logger.log(`MCP client connected (${connectionId}): ${connection.clientInfo.name} v${connection.clientInfo.version}`);

        this.commandHandler.setClientInfo(connection.clientInfo);
        this.browserWebSocketManager.setMcpClientInfo(connection.clientInfo);
      }

      return {
        // Echo the client's requested protocol version so strict clients
        // (e.g. current Claude Desktop sending 2025-11-25) don't reject a
        // hardcoded mismatch and crash-loop.
        protocolVersion: request.params.protocolVersion,
        capabilities: {
          tools: {},
          resources: {}
        },
        serverInfo: SERVER_INFO
      };
    });

    // Handle initialized notification
    server.oninitialized = () => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        logger.log(`Client initialized (${connectionId})`);
        connection.initialized = true;

        // Send initial notifications if tabs are connected
        if (this.tabRegistry.getAll().length > 0) {
          this.sendTabListChangeNotification().catch(error => {
            logger.error('Failed to send initial tabs notification:', error);
          });
        }
      }
    };

    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolHandler.getTools()
      };
    });

    // Call tool handler
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.toolHandler.callTool(name, args);
    });

    // List resources handler
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const allResources = [
        ...baseResources,
        ...Array.from(this.dynamicTabResources.values())
      ];

      return {
        resources: allResources
      };
    });

    // Read resource handler
    server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return await this.resourceHandler.readResource(uri);
    });


    // Handle server close
    server.onclose = () => {
      logger.log(`MCP server connection closed (${connectionId})`);
    };

    return server;
  }

  async connectWebSocket(ws: WebSocket): Promise<void> {
    const connectionId = `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const server = this.createMCPServer(connectionId);

    this.connections.set(connectionId, {
      id: connectionId,
      server,
      type: 'websocket',
      initialized: false
    });

    const transport = new WebSocketTransport(ws);

    try {
      await server.connect(transport);
      // logger.log(`MCP WebSocket server connected (${connectionId})`);
    } catch (error) {
      logger.error(`Failed to connect MCP WebSocket server (${connectionId}):`, error);
      this.connections.delete(connectionId);
      ws.close();
    }

    // Clean up on close
    ws.on('close', () => {
      logger.log(`MCP WebSocket client disconnected (${connectionId})`);
      this.connections.delete(connectionId);
    });
  }

  // Used to show the connected MCP clients at http://localhost:61822/
  getConnectionInfo(): Array<{ id: string; type: string; clientInfo?: any; initialized: boolean }> {
    return Array.from(this.connections.values()).map(conn => ({
      id: conn.id,
      type: conn.type,
      clientInfo: conn.clientInfo,
      initialized: conn.initialized
    }));
  }
}

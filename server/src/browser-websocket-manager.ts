import { WebSocketServer, WebSocket } from 'ws';
import { TabRegistry } from './tab-registry.js';
import { logger } from './logger.js';

interface Message {
  type: string;
  [key: string]: any;
}

interface RegisterMessage extends Message {
  type: 'register';
  requestedTabId?: string;  // Optional - client can request to reuse a tab ID
  url?: string;
  title?: string;
  browser?: string;
  version?: string;  // Extension version (absent on older extensions)
  domSize?: number;
  fullPageDimensions?: { width: number; height: number };
  viewportDimensions?: { width: number; height: number };
}

interface ResponseMessage extends Message {
  id: string;
  type: 'response';
  success: boolean;
  result?: any;
  error?: {
    message: string;
    code: string;
  };
}

export class BrowserWebSocketManager {
  private responseHandler?: (response: ResponseMessage) => void;
  private mcpClientInfo: { name?: string; version?: string } = {};

  constructor(
    private wss: WebSocketServer,
    private tabRegistry: TabRegistry
  ) {
    this.setupWebSocketServer();
  }


  setResponseHandler(handler: (response: ResponseMessage) => void): void {
    this.responseHandler = handler;
  }

  setMcpClientInfo(info: { name?: string; version?: string }): void {
    this.mcpClientInfo = info;

    // Notify all connected tabs about the MCP client
    for (const tab of this.tabRegistry.getAll()) {
      tab.ws.send(JSON.stringify({
        type: 'mcp-client-update',
        mcpClient: info
      }));
    }
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', (ws: WebSocket, request) => {
      logger.log(`New WebSocket connection: ${request.url}`);

      // Skip MCP connections - they're handled at the HTTP server level
      if (request.url === '/mcp') {
        return;
      }

      // Regular browser tab connection
      // Set up ping/pong for connection health
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 10000);

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as Message;
          this.routeBrowserMessage(ws, message);
        } catch (error) {
          logger.error('Failed to parse message:', error);
          ws.send(JSON.stringify({
            type: 'error',
            error: {
              message: 'Invalid message format',
              code: 'INVALID_MESSAGE'
            }
          }));
        }
      });

      ws.on('pong', () => {
        const connection = this.tabRegistry.findByWebSocket(ws);
        if (connection) {
          this.tabRegistry.updateLastPing(connection.tabId);
        }
      });

      ws.on('close', (e) => {
        console.log('Connection closed', e);
        clearInterval(pingInterval);
        const connection = this.tabRegistry.findByWebSocket(ws);
        if (connection) {
          logger.log(`WebSocket closing for tab ${connection.tabId}`);
          this.tabRegistry.unregister(connection.tabId);
        } else {
          logger.log('WebSocket connection closed but no tab found');
        }
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });
    });
  }

  /**
   * Central message router for all WebSocket messages from Chrome extensions
   * Handles different message types:
   * - 'register': New tab registration or reconnection
   * - 'response': Command execution results from the browser
   * - 'tab-info': Tab metadata updates (URL, title, dimensions, etc.)
   * - 'eval-permission': User toggled "Allow JavaScript Execution" for the tab
   * - Unknown types: Sends error response back to extension
   */
  private routeBrowserMessage(ws: WebSocket, message: Message): void {
    switch (message.type) {
      case 'register':
        this.handleTabRegistration(ws, message as RegisterMessage);
        break;

      case 'response':
        // Handle command responses from extensions
        logger.log('Received response:', JSON.stringify(message));
        if (this.responseHandler) {
          logger.log('Calling response handler with message id:', message.id);
          this.responseHandler(message as ResponseMessage);
        } else {
          logger.warn('No response handler set');
        }
        break;

      case 'tab-info':
        // Handle tab info updates
        const connection = this.tabRegistry.findByWebSocket(ws);
        if (connection && message.url) {
          this.tabRegistry.updateTabInfo(connection.tabId, {
            url: message.url,
            title: message.title,
            domSize: message.domSize,
            fullPageDimensions: message.fullPageDimensions,
            viewportDimensions: message.viewportDimensions,
            scrollPosition: message.scrollPosition,
            pageVisibility: message.pageVisibility
          });
          logger.log(`Tab ${connection.tabId} info updated: ${message.url}`);
        }
        break;

      case 'eval-permission':
        // User toggled "Allow JavaScript Execution" in the extension UI
        const evalConnection = this.tabRegistry.findByWebSocket(ws);
        if (evalConnection) {
          this.tabRegistry.updateTabInfo(evalConnection.tabId, {
            evalAllowed: message.allowed === true
          });
          logger.log(`Tab ${evalConnection.tabId} eval permission: ${message.allowed === true}`);
        }
        break;

      case 'ping':
        // Handle keepalive ping from extension - just send pong back
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: message.timestamp || Date.now()
        }));
        break;

      default:
        logger.warn('Unknown message type:', message.type);
        ws.send(JSON.stringify({
          type: 'error',
          error: {
            message: `Unknown message type: ${message.type}`,
            code: 'UNKNOWN_MESSAGE_TYPE'
          }
        }));
    }
  }

  /**
   * Handles tab registration when a Chrome extension connects
   * This function:
   * 1. Assigns a tab ID (either the requested one or generates a new one)
   * 2. Handles reconnection scenarios by terminating old connections
   * 3. Registers the WebSocket connection with the tab registry
   * 4. Sends back the assigned tab ID to the extension
   * 5. Triggers connect/update callbacks for notifications
   */
  private handleTabRegistration(ws: WebSocket, message: RegisterMessage): void {
    const { requestedTabId, url, title, browser, version, domSize, fullPageDimensions, viewportDimensions,
            scrollPosition, pageVisibility } = message;

    // Tab ID is required - extension must provide its Chrome tab ID
    if (!requestedTabId) {
      ws.send(JSON.stringify({
        type: 'error',
        error: {
          message: 'Tab ID is required for registration',
          code: 'TAB_ID_REQUIRED'
        }
      }));
      ws.close();
      return;
    }

    const tabId = requestedTabId;

    // Check if there's an existing connection with this tab ID
    const existing = this.tabRegistry.get(tabId);
    if (existing && existing.ws !== ws) {
      logger.log(`Terminating existing connection for tab ${tabId} to allow new connection`);
      // Terminate the old connection immediately
      existing.ws.terminate();
      // Immediately unregister to free up the tab ID
      this.tabRegistry.unregister(tabId);
    }

    // Register the new connection with the tab ID (without triggering callback yet)
    this.tabRegistry.registerWithoutCallback(tabId, ws);

    // Update tab info if provided
    if (url || title || browser || version || domSize || fullPageDimensions || viewportDimensions ||
        scrollPosition || pageVisibility) {
      this.tabRegistry.updateTabInfo(tabId, {
        url,
        title,
        browser,
        version,
        domSize,
        fullPageDimensions,
        viewportDimensions,
        scrollPosition,
        pageVisibility
      });
    }

    // Now trigger the connect callback after tab info is set
    this.tabRegistry.triggerConnectCallback(tabId);

    // Send acknowledgment with the tab ID and MCP client info
    const registeredMessage: any = {
      type: 'registered',
      tabId: tabId,
      message: 'Successfully registered'
    };

    // Include MCP client info if available
    if (this.mcpClientInfo && this.mcpClientInfo.name) {
      registeredMessage.mcpClient = this.mcpClientInfo;
    }

    ws.send(JSON.stringify(registeredMessage));

    // Request tab info update
    ws.send(JSON.stringify({
      type: 'request',
      action: 'update-tab-info'
    }));
  }

  sendCommand(tabId: string, command: any): void {
    const connection = this.tabRegistry.get(tabId);
    if (!connection) {
      throw new Error(`Tab ${tabId} not found`);
    }

    if (connection.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Tab ${tabId} connection is not open`);
    }

    logger.log(`Sending command to tab ${tabId}:`, JSON.stringify(command));
    connection.ws.send(JSON.stringify(command));
  }

  shutdown(): void {
    // Close all WebSocket connections
    for (const connection of this.tabRegistry.getAll()) {
      connection.ws.close();
    }
  }
}

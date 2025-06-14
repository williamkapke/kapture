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

export class WebSocketManager {
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
    this.wss.on('connection', (ws: WebSocket) => {
      logger.log('New WebSocket connection');
      
      // Set up ping/pong for connection health
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 30000);

      ws.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString()) as Message;
          this.handleMessage(ws, message);
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

      ws.on('close', () => {
        clearInterval(pingInterval);
        const connection = this.tabRegistry.findByWebSocket(ws);
        if (connection) {
          this.tabRegistry.unregister(connection.tabId);
        }
        logger.log('WebSocket connection closed');
      });

      ws.on('error', (error) => {
        logger.error('WebSocket error:', error);
      });
    });
  }

  private handleMessage(ws: WebSocket, message: Message): void {
    switch (message.type) {
      case 'register':
        this.handleRegister(ws, message as RegisterMessage);
        break;
      
      case 'response':
        // Handle command responses from extensions
        logger.log('Received response:', JSON.stringify(message));
        logger.log('Response details:', {
          id: message.id,
          success: (message as ResponseMessage).success,
          result: (message as ResponseMessage).result,
          hasResult: 'result' in message,
          resultType: typeof (message as ResponseMessage).result
        });
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
            title: message.title
          });
          logger.log(`Tab ${connection.tabId} info updated: ${message.url}`);
        }
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

  private handleRegister(ws: WebSocket, message: RegisterMessage): void {
    const { requestedTabId, url, title } = message;
    
    // Server assigns the tab ID
    const assignedTabId = this.tabRegistry.assignTabId(requestedTabId);
    
    // Check if we need to close an old connection with the same ID
    if (requestedTabId && requestedTabId === assignedTabId) {
      const existing = this.tabRegistry.get(assignedTabId);
      if (existing) {
        // Close the old connection
        existing.ws.close();
      }
    }

    // Register the new connection with the assigned ID
    this.tabRegistry.register(assignedTabId, ws);

    // Update tab info if provided
    if (url || title) {
      this.tabRegistry.updateTabInfo(assignedTabId, { url, title });
    }

    // Send acknowledgment with the assigned tab ID and MCP client info
    const registeredMessage: any = {
      type: 'registered',
      tabId: assignedTabId,
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

    logger.log(`Tab ${assignedTabId} registered${requestedTabId && requestedTabId !== assignedTabId ? ` (requested: ${requestedTabId})` : ''}. Active tabs: ${this.tabRegistry.getActiveTabCount()}`);
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
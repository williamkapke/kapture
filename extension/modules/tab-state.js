
// WebSocket connection info
import { ConnectionStatus, Message } from "./models.js";

export class ConnectionInfo {
  constructor(url) {
    this.url = url;
    this.status = ConnectionStatus.DISCONNECTED;
    this.connected = false;
    this.userDisconnected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.nextRetryIn = null;
  }

  setConnected() {
    this.status = ConnectionStatus.CONNECTED;
    this.connected = true;
    this.reconnectAttempts = 0;
    this.nextRetryIn = null;
  }

  setDisconnected(userInitiated = false) {
    this.status = ConnectionStatus.DISCONNECTED;
    this.connected = false;
    this.userDisconnected = userInitiated;
    if (userInitiated) {
      this.reconnectAttempts = 0;
      this.nextRetryIn = null;
    }
  }

  setRetrying(attemptNumber, nextRetryMs) {
    this.status = ConnectionStatus.RETRYING;
    this.connected = false;
    this.reconnectAttempts = attemptNumber;
    this.nextRetryIn = nextRetryMs;
  }

  setError(error) {
    this.status = ConnectionStatus.ERROR;
    this.connected = false;
  }
}

// Main tab state class
export class TabState {
  constructor(tabId) {
    this.tabId = tabId;
    this.websocket = null;
    this.connectionInfo = new ConnectionInfo('ws://127.0.0.1:61822');
    this.messages = [];
    this.ports = new Set(); // Connected DevTools panels/popups
    this.pageMetadata = {};
    this.mousePosition = { x: 0, y: 0 }; // Track current mouse position
  }

  // WebSocket management
  setWebSocket(ws) {
    this.websocket = ws;
  }

  clearWebSocket() {
    this.websocket = null;
  }

  // Message management
  addMessage(direction, data) {
    const message = new Message(direction, data);
    this.messages.push(message);
    return message;
  }

  clearMessages() {
    this.messages = [];
  }

  getMessages(limit = null) {
    if (limit === null) {
      return [...this.messages];
    }
    return this.messages.slice(-limit);
  }

  // Port management
  addPort(port) {
    this.ports.add(port);
  }

  removePort(port) {
    this.ports.delete(port);
  }

  broadcastToPorts(message) {
    this.ports.forEach(port => {
      try {
        port.postMessage(message);
      } catch (e) {
        // Port might be disconnected
        this.ports.delete(port);
      }
    });
  }

  // State management
  getConnectionState() {
    return {
      connected: this.connectionInfo.connected,
      status: this.connectionInfo.status,
      reconnectAttempt: this.connectionInfo.reconnectAttempts,
      nextRetryIn: this.connectionInfo.nextRetryIn
    };
  }

  updatePageMetadata(metadata) {
    this.pageMetadata = metadata;
  }

  // Mouse position tracking
  setMousePosition(position) {
    this.mousePosition = { ...position };
  }

  // Cleanup
  cleanup() {
    // Clear reconnect timer
    if (this.connectionInfo.reconnectTimer) {
      clearTimeout(this.connectionInfo.reconnectTimer);
      this.connectionInfo.reconnectTimer = null;
    }

    // Close WebSocket
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    // Clear all data
    this.messages = [];
    this.ports.clear();
  }
}

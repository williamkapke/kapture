import { TabState } from './tab-state.js';
import { backgroundCommands, getTabInfo, detectBrowser } from './background-commands.js';
import { stopNetworkMonitor } from './background-network.js';

export class TabManager {
  constructor() {
    this.tabs = new Map(); // tabId -> TabState
    this.listeners = new Set(); // State change listeners
    this.keepaliveMs = 30000; // configurable via the 'keepaliveSeconds' setting
    this._initKeepaliveSetting();
  }

  // Load the configurable keepalive interval and react to panel changes.
  async _initKeepaliveSetting() {
    try {
      const { keepaliveSeconds } = await chrome.storage.local.get('keepaliveSeconds');
      this.keepaliveMs = this._keepaliveMsFrom(keepaliveSeconds);
    } catch (e) { /* storage unavailable -> keep default */ }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.keepaliveSeconds) return;
      this.keepaliveMs = this._keepaliveMsFrom(changes.keepaliveSeconds.newValue);
      this._restartKeepalives();
    });
  }

  _keepaliveMsFrom(seconds) {
    const n = Number(seconds);
    return Number.isFinite(n) && n > 0 ? n * 1000 : 30000;
  }

  _startKeepalive(tabState) {
    const ws = tabState.websocket;
    return setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
        } catch (e) {
          console.error('Failed to send keepalive ping:', e);
        }
      }
    }, this.keepaliveMs);
  }

  // Re-arm keepalive on connected tabs after the interval setting changes.
  _restartKeepalives() {
    for (const tabState of this.tabs.values()) {
      if (tabState.keepaliveInterval) {
        clearInterval(tabState.keepaliveInterval);
        tabState.keepaliveInterval = null;
      }
      if (tabState.websocket && tabState.websocket.readyState === WebSocket.OPEN) {
        tabState.keepaliveInterval = this._startKeepalive(tabState);
      }
    }
  }

  // Tab lifecycle
  getOrCreateTab(tabId) {
    if (!this.tabs.has(tabId)) {
      const tabState = new TabState(tabId);
      this.tabs.set(tabId, tabState);
      this.notifyListeners(tabId, 'created', tabState);
    }
    return this.tabs.get(tabId);
  }

  getTab(tabId) {
    return this.tabs.get(tabId);
  }

  hasTab(tabId) {
    return this.tabs.has(tabId);
  }

  removeTab(tabId) {
    const tabState = this.tabs.get(tabId);
    if (tabState) {
      tabState.cleanup();
      this.tabs.delete(tabId);
      this.notifyListeners(tabId, 'removed', null);
    }
  }

  // WebSocket connection management
  async connect(tabId) {
    const tabState = this.getOrCreateTab(tabId);

    if (tabState.websocket && tabState.websocket.readyState === WebSocket.OPEN) {
      return { ok: true, message: 'Already connected' };
    }

    try {
      // Get tab info from content script. This fails when the content script
      // isn't present - most commonly right after the extension is reloaded
      // (Chrome doesn't re-inject into already-open tabs until they reload).
      const tabInfo = await getTabInfo(tabId);
      tabState.updatePageMetadata(tabInfo);

      // Set up connection
      tabState.connectionInfo.userDisconnected = false;

      await this._createConnection(tabState);

      return { ok: true };
    } catch (error) {
      // Reconcile UI: without this the popup/panel toggle stays stuck "on"
      // (green) while actually disconnected, because the caller's optimistic
      // checkbox flip is never corrected.
      tabState.evalAllowed = false;
      tabState.connectionInfo.setDisconnected(true);
      this.notifyListeners(tabId, 'stateChanged', tabState);
      return { ok: false, error: error.message };
    }
  }

  // "Allow JavaScript Execution" toggle. In-memory only - any disconnect resets it.
  setEvalAllowed(tabId, allowed) {
    const tabState = this.getTab(tabId);
    if (!tabState) {
      return { ok: false, error: 'Tab not found' };
    }

    tabState.evalAllowed = !!allowed;

    // Tell the server so it can show/hide the evaluate tool
    if (tabState.websocket && tabState.websocket.readyState === WebSocket.OPEN) {
      this.sendMessage(tabId, { type: 'eval-permission', allowed: tabState.evalAllowed });
    }

    this.notifyListeners(tabId, 'stateChanged', tabState);
    return { ok: true };
  }

  disconnect(tabId) {
    const tabState = this.getTab(tabId);
    if (!tabState) {
      return { ok: false, error: 'Tab not found' };
    }

    tabState.evalAllowed = false;
    tabState.connectionInfo.setDisconnected(true);

    // Clear keepalive interval
    if (tabState.keepaliveInterval) {
      clearInterval(tabState.keepaliveInterval);
      tabState.keepaliveInterval = null;
    }

    if (tabState.websocket) {
      tabState.websocket.close();
      tabState.clearWebSocket();
    }

    // Clear any pending reconnect
    if (tabState.connectionInfo.reconnectTimer) {
      clearTimeout(tabState.connectionInfo.reconnectTimer);
      tabState.connectionInfo.reconnectTimer = null;
    }

    this.notifyListeners(tabId, 'stateChanged', tabState);

    return { ok: true };
  }

  // Private connection methods
  async _createConnection(tabState) {
    // First check if tab still exists
    try {
      await chrome.tabs.get(tabState.tabId);
    } catch (error) {
      console.log(`Tab ${tabState.tabId} no longer exists, aborting connection`);
      this.removeTab(tabState.tabId);
      return;
    }

    const ws = new WebSocket(tabState.connectionInfo.url);
    tabState.setWebSocket(ws);

    // Clear any existing keepalive interval
    if (tabState.keepaliveInterval) {
      clearInterval(tabState.keepaliveInterval);
      tabState.keepaliveInterval = null;
    }

    ws.onopen = () => {
      tabState.connectionInfo.setConnected();
      this.notifyListeners(tabState.tabId, 'stateChanged', tabState);

      // Send registration message with Chrome tab ID and metadata
      const registerMessage = {
        type: 'register',
        requestedTabId: tabState.tabId.toString(), // Chrome tab ID
        browser: detectBrowser(), // Add browser type
        version: chrome.runtime.getManifest().version, // Extension version
        ...tabState.pageMetadata
      };

      this.sendMessage(tabState.tabId, registerMessage);

      // Set up keepalive ping (interval configurable via panel setting, default 30s)
      tabState.keepaliveInterval = this._startKeepalive(tabState);
    };

    ws.onclose = () => {
      // Clear keepalive interval
      if (tabState.keepaliveInterval) {
        clearInterval(tabState.keepaliveInterval);
        tabState.keepaliveInterval = null;
      }

      // Any disconnect (user toggle, server restart, tab close) revokes the
      // "Allow JavaScript Execution" grant - it must be re-enabled manually.
      tabState.evalAllowed = false;

      // Stop network monitoring too - the server tracks who wants it, so a
      // dead connection means nobody can ever turn it off otherwise.
      stopNetworkMonitor(tabState.tabId).catch(() => {});

      tabState.clearWebSocket();

      if (!tabState.connectionInfo.userDisconnected) {
        // Schedule reconnect
        this._scheduleReconnect(tabState);
      } else {
        tabState.connectionInfo.setDisconnected(true);
      }

      this.notifyListeners(tabState.tabId, 'stateChanged', tabState);
    };

    ws.onerror = (error) => {
      console.error(`WebSocket error for tab ${tabState.tabId}:`, error);
      tabState.connectionInfo.setError(error);
      // Don't clear WebSocket here - let onclose handle cleanup and reconnection
      this.notifyListeners(tabState.tabId, 'stateChanged', tabState);
    };

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        // Don't track pong messages
        if (data.type !== 'pong') {
          const message = tabState.addMessage('incoming', data);
          this.notifyListeners(tabState.tabId, 'messageReceived', tabState, message);
        }

        // Handle commands
        if (data.type === 'command' && data.command && data.id) {
          await this._handleCommand(tabState, data);
        } else if (data.type === 'pong') {
          // Pong received - connection is healthy
          tabState.lastPongTime = Date.now();
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };
  }

  _scheduleReconnect(tabState) {
    // Clear any existing reconnect timer
    if (tabState.connectionInfo.reconnectTimer) {
      clearTimeout(tabState.connectionInfo.reconnectTimer);
      tabState.connectionInfo.reconnectTimer = null;
    }

    const attemptNumber = tabState.connectionInfo.reconnectAttempts;
    const backoffMs = this._getBackoffMs(attemptNumber);

    console.log(`Scheduling reconnect for tab ${tabState.tabId} in ${backoffMs}ms (attempt ${attemptNumber + 1})`);

    tabState.connectionInfo.setRetrying(attemptNumber + 1, backoffMs);
    this.notifyListeners(tabState.tabId, 'stateChanged', tabState);

    tabState.connectionInfo.reconnectTimer = setTimeout(async () => {
      if (!tabState.connectionInfo.userDisconnected) {
        // Check if tab still exists before attempting reconnect
        try {
          await chrome.tabs.get(tabState.tabId);
          console.log(`Attempting reconnect for tab ${tabState.tabId}`);
          this._createConnection(tabState);
        } catch (error) {
          console.log(`Tab ${tabState.tabId} no longer exists, removing from manager`);
          this.removeTab(tabState.tabId);
        }
      }
    }, backoffMs);
  }

  _getBackoffMs(attemptNumber) {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, then cap at 60s
    return Math.min(1000 * Math.pow(2, attemptNumber), 60000);
  }

  async _handleCommand(tabState, {command, params, id}) {
    try {
      let result;
      // some need to run with the background context
      if (backgroundCommands[command]) {
        result = await backgroundCommands[command](tabState, params);
      }
      // others we execute in the page context
      else {
        result = await chrome.tabs.sendMessage(tabState.tabId, {command, params});
      }
      // `success: true` means we didn't throw an error. TODO: rename or remove it
      const response = {id, type: 'response', success: true, result};
      this.sendMessage(tabState.tabId, response);
    }
    catch (error) {
      const errorResponse = { id, type: 'response', success: false,  error: { message: error.message, code: 'COMMAND_FAILED' }};
      this.sendMessage(tabState.tabId, errorResponse);
    }
  }

  // Message sending
  sendMessage(tabId, data) {
    const tabState = this.getTab(tabId);
    if (!tabState || !tabState.websocket || tabState.websocket.readyState !== WebSocket.OPEN) {
      return { ok: false, error: 'Not connected' };
    }

    try {
      const message = tabState.addMessage('outgoing', data);
      tabState.websocket.send(JSON.stringify(data));
      this.notifyListeners(tabId, 'messageSent', tabState, message);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Message management
  clearMessages(tabId) {
    const tabState = this.getTab(tabId);
    if (tabState) {
      tabState.clearMessages();
      this.notifyListeners(tabId, 'messagesCleared', tabState);
    }
  }

  // Port management
  addPort(tabId, port) {
    const tabState = this.getOrCreateTab(tabId);
    tabState.addPort(port);

    // Send initial state
    port.postMessage({
      type: 'state',
      tabId,
      ...tabState.getConnectionState()
    });

    // Send current messages
    port.postMessage({
      type: 'messages',
      tabId,
      messages: tabState.getMessages()
    });
  }

  removePort(tabId, port) {
    const tabState = this.getTab(tabId);
    if (tabState) {
      tabState.removePort(port);
    }
  }

  // Event listeners
  addListener(callback) {
    this.listeners.add(callback);
  }

  removeListener(callback) {
    this.listeners.delete(callback);
  }

  notifyListeners(tabId, event, tabState, data = null) {
    this.listeners.forEach(callback => {
      try {
        callback(tabId, event, tabState, data);
      } catch (e) {
        console.error('Error in TabManager listener:', e);
      }
    });
  }

  // Utility
  getAllTabs() {
    return Array.from(this.tabs.values());
  }

  getActiveTabCount() {
    return this.tabs.size;
  }
}

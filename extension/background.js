// Background service worker - manages WebSocket connections

import { TabManager } from './modules/tab-manager.js';

// Single source of truth for all tab state
const tabManager = new TabManager();

// Helper function to send connection state to content script
function sendConnectionStateToTab(tabId, connectionState) {
  chrome.tabs.sendMessage(tabId, {
    command: '_connectionStateChanged',
    params: {
      status: connectionState.status,
      connected: connectionState.connected
    }
  }).catch(err => {
    // Content script might not be injected yet, ignore error
    console.debug('Could not send connection state to tab:', err);
  });
}

// Listen for tab state changes
tabManager.addListener((tabId, event, tabState, data) => {
  switch (event) {
    case 'stateChanged':
      // Broadcast to all ports for this tab
      tabState.broadcastToPorts({
        type: 'state',
        tabId,
        ...tabState.getConnectionState()
      });

      // Send connection state to content script
      const connectionState = tabState.getConnectionState();
      sendConnectionStateToTab(tabId, connectionState);

      // Update action badge for active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id === tabId) {
          updateActionBadge(tabState.getConnectionState());
        }
      });
      break;

    case 'messageReceived':
    case 'messageSent':
      // Broadcast updated messages to all ports
      tabState.broadcastToPorts({
        type: 'messages',
        tabId,
        messages: tabState.getMessages()
      });
      break;

    case 'messagesCleared':
      tabState.broadcastToPorts({
        type: 'messages',
        tabId,
        messages: []
      });
      break;
  }
});

// Update action badge based on connection status
function updateActionBadge(state) {
  switch (state.status) {
    case 'connected':
      chrome.action.setBadgeText({ text: '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#4caf50' });
      break;

    case 'retrying':
      chrome.action.setBadgeText({ text: '↻' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
      break;

    case 'disconnected':
    default:
      chrome.action.setBadgeText({ text: '' });
      break;
  }
}

// Handle UI connections
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => {
    if (msg.type === 'subscribe' && msg.tabId) {
      tabManager.addPort(msg.tabId, port);
    } else if (msg.type === 'clearMessages' && msg.tabId) {
      tabManager.clearMessages(msg.tabId);
    }
  });

  port.onDisconnect.addListener(() => {
    // Remove port from all tabs
    tabManager.getAllTabs().forEach(tabState => {
      tabState.removePort(port);
    });
  });
});

// Handle all messages
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  // Handle content script messages
  if (sender.tab) {
    if (request.type === 'contentScriptReady') {
      console.log(`Content script ready in tab ${sender.tab.id}`);
      
      // Send current connection state to the newly ready content script
      const tabState = tabManager.getTab(sender.tab.id);
      if (tabState) {
        const connectionState = tabState.getConnectionState();
        sendConnectionStateToTab(sender.tab.id, connectionState);
      }
      
      sendResponse({ acknowledged: true });
      return false;
    }

    if (request.type === 'connect') {
      const result = await tabManager.connect(sender.tab.id);
      sendResponse(result);
      return true; // Keep message channel open for async response
    }

    if (request.type === 'disconnect') {
      const result = tabManager.disconnect(sender.tab.id);
      sendResponse(result);
      return false;
    }

    if (request.type === 'openPopup') {
      chrome.action.openPopup();
      sendResponse({ ok: true });
      return false;
    }

    if (request.type === 'mousePosition') {
      // Store mouse position for the tab
      const tabState = tabManager.getTab(sender.tab.id);
      if (tabState) {
        tabState.setMousePosition({ x: request.x, y: request.y });
      }
      return false;
    }
  }

  // Handle messages from popup/panel (not from content scripts)
  if (!sender.tab) {
    if (request.type === 'connect' && request.tabId) {
      const result = await tabManager.connect(request.tabId);
      sendResponse(result);
      return true; // Keep message channel open for async response
    }

    if (request.type === 'disconnect' && request.tabId) {
      const result = tabManager.disconnect(request.tabId);
      sendResponse(result);
      return false;
    }

    if (request.type === 'getState' && request.tabId) {
      const tabState = tabManager.getTab(request.tabId);
      sendResponse(tabState ? tabState.getConnectionState() : { connected: false, status: 'disconnected' });
      return false;
    }

    if (request.type === 'setEvalAllowed' && request.tabId) {
      const result = tabManager.setEvalAllowed(request.tabId, request.allowed);
      sendResponse(result);
      return false;
    }
  }
});

// Update badge when active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  const tabState = tabManager.getTab(activeInfo.tabId);
  if (tabState) {
    updateActionBadge(tabState.getConnectionState());
  } else {
    updateActionBadge({ status: 'disconnected' });
  }
});

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabManager.removeTab(tabId);
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    const destination = { url: 'https://to.kap.co/kapture-welcome' };
    // Navigate the current active tab instead of creating a new one
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.update(tabs[0].id, destination);
      }
      else {
        // Fallback: create a new tab if no active tab is found
        chrome.tabs.create(destination);
      }
    });
  }
});

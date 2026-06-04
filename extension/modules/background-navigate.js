// Import helper functions from background-commands
import { getFromContentScript, respondWith, respondWithError } from './background-commands.js';

// Check if URL is allowed for extension
const isAllowedUrl = (url) => !!url && (url.startsWith('http://') || url.startsWith('https://'));

// Wait for content script to be ready
async function waitForContentScriptReady(tabId, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error('Timeout waiting for content script'));
    }, timeout);

    const listener = (request, sender) => {
      if (request.type === 'contentScriptReady' && sender.tab?.id === tabId) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    };

    chrome.runtime.onMessage.addListener(listener);
  });
}

// Execute navigation and wait for content script
async function executeNavigation(tabId, navigationFn) {
  try {
    await navigationFn();
    await waitForContentScriptReady(tabId);
    return await respondWith(tabId, {});
  } catch (error) {
    return respondWithError(tabId, 'NAVIGATION_FAILED', error.message);
  }
}

// Navigation commands
export async function navigate({tabId}, { url }) {
  if (!isAllowedUrl(url)) {
    return respondWithError(tabId, 'NAVIGATION_BLOCKED', `Navigation to ${url} is not allowed`);
  }
  return executeNavigation(tabId, async () => getFromContentScript(tabId, '_navigate', { url }));
}

export async function back({tabId}) {
  return executeNavigation(tabId, () => chrome.tabs.goBack(tabId));
}

export async function forward({tabId}) {
  return executeNavigation(tabId, () => chrome.tabs.goForward(tabId));
}

export async function close({tabId}) {
  // Verify the tab exists first so an invalid id still reports CLOSE_FAILED.
  try {
    await chrome.tabs.get(tabId);
  } catch (error) {
    return { success: false, error: { code: 'CLOSE_FAILED', message: error.message } };
  }
  // Defer the actual removal so the command response is delivered before the
  // tab's connection is torn down. Removing it synchronously drops the ack and
  // the client times out waiting for it.
  setTimeout(() => { chrome.tabs.remove(tabId).catch(() => {}); }, 0);
  return { success: true, closed: true };
}

export async function reload({tabId}) {
  return executeNavigation(tabId, () => chrome.tabs.reload(tabId));
}

export async function show({tabId}) {
  try {
    // Get the tab to find its window ID
    const tab = await chrome.tabs.get(tabId);
    
    // Bring the window to the front
    await chrome.windows.update(tab.windowId, { focused: true });
    
    // Make the tab active in the window
    await chrome.tabs.update(tabId, { active: true });
    
    return await respondWith(tabId, { shown: true });
  } catch (error) {
    return respondWithError(tabId, 'SHOW_FAILED', error.message);
  }
}
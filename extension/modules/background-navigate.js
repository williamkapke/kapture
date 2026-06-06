// Import helper functions from background-commands
import { respondWith, respondWithError, attachDebugger } from './background-commands.js';

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
  // Navigate via CDP so it creates a real session-history entry. Gesture-less
  // programmatic navigations (content-script `location.href`, `chrome.tabs.update`)
  // get coalesced by Chrome into a replacement, leaving back/forward with no
  // history. Page.navigate records history the way a real navigation does.
  try {
    return await attachDebugger(tabId, async () => {
      // Listen before navigating so we don't miss the ready signal.
      const ready = waitForContentScriptReady(tabId);
      // Navigate via a user-activated script execution. Chrome's
      // history-manipulation intervention marks an entry as "skippable" when its
      // page is navigated away from without ever receiving user activation, so
      // back/forward skip right over programmatic navigations. Running the
      // navigation with userGesture:true gives the source page activation, so
      // its entry stays in the back/forward chain.
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
        expression: `location.assign(${JSON.stringify(url)})`,
        userGesture: true
      }).catch(() => { /* navigation tears down the context; `ready` confirms success */ });
      await ready;
      return await respondWith(tabId, {});
    });
  } catch (error) {
    return respondWithError(tabId, 'NAVIGATION_FAILED', error.message);
  }
}

// Wait for a history navigation (back/forward) to land. Unlike a fresh load,
// these often restore from the back-forward cache or are same-document, so the
// content script never re-fires "ready". Poll for the URL to change and the
// content script (restored or freshly injected) to answer instead.
async function settleHistoryNavigation(tabId, beforeUrl, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (e) {
      throw new Error('Tab closed during navigation');
    }
    if (tab.url && tab.url !== beforeUrl) {
      try {
        return await respondWith(tabId, {}); // resolves once the page answers
      } catch (e) { /* content script not ready yet */ }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Navigation did not complete in time');
}

async function historyNavigate(tabId, move) {
  let beforeUrl;
  try {
    beforeUrl = (await chrome.tabs.get(tabId)).url;
  } catch (e) {
    return respondWithError(tabId, 'NAVIGATION_FAILED', e.message);
  }
  try {
    await move();
    return await settleHistoryNavigation(tabId, beforeUrl);
  } catch (error) {
    return respondWithError(tabId, 'NAVIGATION_FAILED', error.message);
  }
}

export async function back({tabId}) {
  return historyNavigate(tabId, () => chrome.tabs.goBack(tabId));
}

export async function forward({tabId}) {
  return historyNavigate(tabId, () => chrome.tabs.goForward(tabId));
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
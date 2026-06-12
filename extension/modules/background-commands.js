import { keypress } from './background-keypress.js';
import { click, hover } from './background-click.js';
import { navigate, back, forward, close, reload, show } from './background-navigate.js';
import { screenshot } from './background-screenshot.js';
import { getLogs, watchConsole } from './background-console.js';
import { networkMonitor, networkRequests, networkBody } from './background-network.js';
import { evaluate } from './background-evaluate.js';
import { type, insertText, clear } from './background-text.js';
import { dialog } from './background-dialog.js';

export const getFromContentScript = async (tabId, command, params, ) => {
  return await chrome.tabs.sendMessage(tabId, { command, params });
}

// Detect browser type from user agent
export const detectBrowser = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  
  // Check for Chromium-based browsers that support Chrome extensions
  if (userAgent.includes('edg/')) {
    return 'edge';
  } else if (userAgent.includes('opr/') || userAgent.includes('opera/')) {
    return 'opera';
  } else if (userAgent.includes('vivaldi/')) {
    return 'vivaldi';
  } else if (userAgent.includes('brave/')) {
    return 'brave';
  } else if (userAgent.includes('chrome/')) {
    // Additional check for Brave which doesn't always include 'brave' in UA
    if (navigator.brave && navigator.brave.isBrave) {
      return 'brave';
    }
    return 'chrome';
  } else {
    // Default to chromium for any other Chromium-based browser
    return 'chromium';
  }
};

export const getTabInfo = async(tabId) => await getFromContentScript(tabId, 'getTabInfo');
export const getElement = async (tabId, selector, xpath, visible) => {
  return await getFromContentScript(tabId, 'element', { selector, xpath, visible });
}

export const respondWith = async (tabId, obj, selector, xpath) => {
  const info = await getTabInfo(tabId);
  return {
    success: !obj.error,
    selector,
    xpath: !selector ? xpath : undefined,
    ...info,
    ...obj
  };
}
export const respondWithError = async (tabId, code, message, selector, xpath) => {
  return respondWith(tabId,{ error: { code, message } }, selector, xpath);
}
// Reference-counted debugger sessions so concurrent commands (e.g. a click
// during a watchConsole) share one attachment instead of fighting over it.
const debuggerSessions = new Map(); // tabId -> { count, ready }

// If the session dies externally (user dismisses the infobar, tab closes),
// forget it so the next command re-attaches.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) debuggerSessions.delete(source.tabId);
});

export async function acquireDebugger(tabId) {
  let session = debuggerSessions.get(tabId);
  if (!session) {
    session = {
      count: 0,
      ready: (async () => {
        await chrome.debugger.attach({tabId}, '1.3');
        await chrome.debugger.sendCommand({tabId}, 'Page.enable');
      })()
    };
    debuggerSessions.set(tabId, session);
  }
  session.count++;
  try {
    await session.ready;
  }
  catch (e) {
    session.count--;
    if (session.count <= 0) debuggerSessions.delete(tabId);
    throw e;
  }
}

export async function releaseDebugger(tabId) {
  const session = debuggerSessions.get(tabId);
  if (!session) return; // already detached externally
  session.count--;
  if (session.count <= 0) {
    debuggerSessions.delete(tabId);
    try {
      await chrome.debugger.detach({tabId: tabId});
    }
    catch (e) { }
  }
}

export async function attachDebugger(tabId, action) {
  await acquireDebugger(tabId);
  try {
    return await action();
  }
  finally {
    await releaseDebugger(tabId);
  }
}

// attachDebugger for input dispatch (click, keypress, type, ...). A hidden
// (background) tab believes it is unfocused, so the renderer won't deliver
// synthesized key events to the focused element and processes mouse events
// unreliably - focus emulation makes the page act focused without stealing
// the user's real focus. Scoped to the action (not the whole session) so a
// long-lived attachment like network monitoring doesn't leave a hidden page
// permanently believing it's focused.
export async function attachDebuggerFocused(tabId, action) {
  return attachDebugger(tabId, async () => {
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch (e) { /* best effort */ }
    try {
      return await action();
    } finally {
      try {
        await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: false });
      } catch (e) { /* session may already be gone */ }
    }
  });
}

// Response wrapper for input commands: input dispatched to a hidden tab is
// best-effort even with focus emulation, and the CDP dispatch "succeeding"
// doesn't prove the page reacted - so say so instead of silently reporting
// success.
export const respondWithInputWarning = async (tabId, obj, selector, xpath) => {
  const res = await respondWith(tabId, obj, selector, xpath);
  if (res.pageVisibility && res.pageVisibility.visible === false) {
    res.warning = 'This tab is hidden (not the active tab). Input events may not be delivered to a hidden tab - if this command had no effect, bring the tab to the front with `show` and retry.';
  }
  return res;
};


export const backgroundCommands = {
  navigate,
  back,
  forward,
  close,
  reload,
  show,
  click,
  hover,
  keypress,
  screenshot,
  getLogs,
  watchConsole,
  networkMonitor,
  networkRequests,
  networkBody,
  evaluate,
  type,
  insertText,
  clear,
  dialog
}

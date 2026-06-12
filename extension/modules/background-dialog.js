// JavaScript dialog (alert/confirm/prompt/onbeforeunload) handling.
//
// A dialog freezes the renderer, so content-script commands and input
// dispatches hang while one is open. Chrome only reports dialogs through
// Page.javascriptDialogOpening on an attached debugger session - which
// Kapture holds exactly when dialogs tend to appear: during the input
// command that triggered one. When that happens we keep the session alive
// past the command (an extra debugger ref) so Page.handleJavaScriptDialog
// can answer it later, and tab-manager fails every other command fast with
// DIALOG_OPEN instead of letting them time out into mystery.
import { acquireDebugger, releaseDebugger, attachDebugger } from './background-commands.js';

const pending = new Map(); // tabId -> { type, message, defaultPrompt }
const waiters = new Map(); // tabId -> Set<resolve>

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;

  if (method === 'Page.javascriptDialogOpening') {
    const dialog = {
      type: params.type, // alert | confirm | prompt | beforeunload
      message: params.message,
      defaultPrompt: params.defaultPrompt || undefined
    };
    pending.set(tabId, dialog);
    // Hold the session so the dialog can still be answered after the command
    // that triggered it detaches. Released when the dialog closes.
    acquireDebugger(tabId).catch(() => {});

    const set = waiters.get(tabId);
    if (set) {
      waiters.delete(tabId);
      for (const resolve of set) resolve(dialog);
    }
  }

  // Closed by us, or by the user clicking the real dialog - either clears it
  if (method === 'Page.javascriptDialogClosed') {
    if (pending.delete(tabId)) {
      releaseDebugger(tabId).catch(() => {});
    }
  }
});

// The session died externally (infobar dismissed, tab closed) - the ref it
// held is already gone, just forget the dialog.
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId) pending.delete(source.tabId);
});

export function getPendingDialog(tabId) {
  return pending.get(tabId);
}

// Resolves if/when a dialog opens on the tab, for racing against a command
// that may freeze the page. disarm() drops the waiter once the race is over.
export function dialogOpened(tabId) {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  if (!waiters.has(tabId)) waiters.set(tabId, new Set());
  waiters.get(tabId).add(resolve);
  return { promise, disarm: () => waiters.get(tabId)?.delete(resolve) };
}

// Drop tracking for a disconnected tab (mirrors stopNetworkMonitor) so a
// dead connection doesn't leave a debugger ref held forever.
export function clearPendingDialog(tabId) {
  waiters.delete(tabId);
  if (pending.delete(tabId)) {
    releaseDebugger(tabId).catch(() => {});
  }
}

const respondHint = (dialog) =>
  `Respond to it with the dialog tool (accept: true/false${dialog.type === 'prompt' ? ', text: "..."' : ''})`;

// Response for the command whose action opened the dialog: the page is now
// frozen, so return immediately with instructions instead of timing out.
export function dialogInterruptResult(dialog) {
  return {
    success: true,
    dialog,
    warning: `A JavaScript ${dialog.type} dialog opened ("${dialog.message}") and is now blocking this page. ` +
      `No other command will work until you respond to it. ${respondHint(dialog)}.`
  };
}

// Fail-fast error for every other command while a dialog is pending.
export function dialogBlockedError(dialog) {
  return {
    success: false,
    error: {
      code: 'DIALOG_OPEN',
      message: `A JavaScript ${dialog.type} dialog ("${dialog.message}") is blocking this tab. ` +
        `${respondHint(dialog)} before issuing other commands.`
    }
  };
}

// The `dialog` command: answer the open dialog.
export async function dialog({ tabId }, { accept, text } = {}) {
  const handleParams = {
    accept: !!accept,
    ...(text !== undefined ? { promptText: text } : {})
  };

  const dlg = pending.get(tabId);
  if (dlg) {
    try {
      // The session is still attached - we held a ref when the dialog opened
      await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', handleParams);
      // Page.javascriptDialogClosed clears `pending` and releases the ref
      return { success: true, handled: true, accept: !!accept, type: dlg.type, message: dlg.message };
    } catch (e) {
      return { success: false, error: { code: 'DIALOG_HANDLE_ERROR', message: e.message } };
    }
  }

  // No dialog we saw open - one may have appeared while nothing was attached
  // (e.g. a page timer). Attach and try blind; Chrome rejects the call when
  // nothing is showing, and may reject for dialogs that predate the session.
  try {
    await attachDebugger(tabId, () =>
      chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', handleParams)
    );
    return { success: true, handled: true, accept: !!accept };
  } catch (e) {
    return {
      success: false,
      error: {
        code: 'NO_DIALOG',
        message: 'No JavaScript dialog is open on this tab (or it opened before Kapture could see it - if one is visible, ask the user to dismiss it).'
      }
    };
  }
}

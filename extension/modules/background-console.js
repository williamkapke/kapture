// Console log retrieval via CDP (Chrome DevTools Protocol).
//
// Chrome buffers console messages per page - the same buffer DevTools shows
// when opened after the fact. Runtime.enable replays that buffer to us, so
// there is no extension-side log storage: getLogs reads the buffer on demand,
// and watchConsole stays attached to collect live events for a duration.

import { respondWith, respondWithError, attachDebugger } from './background-commands.js';

// CDP consoleAPICalled types that don't match our level names directly
const TYPE_TO_LEVEL = {
  warning: 'warn',
  startGroup: 'group',
  startGroupCollapsed: 'groupCollapsed',
  endGroup: 'groupEnd'
};

// Runs in the page via Runtime.callFunctionOn to fully serialize an object
// argument (circular-safe, functions become source strings).
const STRINGIFY_FN = `function() {
  try {
    const seen = new WeakSet();
    return JSON.stringify(this, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      if (typeof value === 'function') return value.toString();
      return value;
    });
  } catch (e) {
    return String(this);
  }
}`;

async function serializeArg(tabId, arg) {
  if (arg.type === 'undefined') return 'undefined';
  if (arg.subtype === 'null') return 'null';
  if (arg.unserializableValue) return arg.unserializableValue; // NaN, Infinity, -0, bigint
  if ('value' in arg) {
    return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  }
  if (arg.type === 'function') return arg.description || 'function';
  if (arg.objectId) {
    try {
      const r = await chrome.debugger.sendCommand({ tabId }, 'Runtime.callFunctionOn', {
        objectId: arg.objectId,
        functionDeclaration: STRINGIFY_FN,
        returnByValue: true
      });
      if (r?.result?.value !== undefined) return String(r.result.value);
    } catch (e) {
      // Object's execution context is gone - fall through to the preview text
    }
  }
  return arg.description ?? String(arg.value);
}

function formatStackTrace(stackTrace) {
  if (!stackTrace?.callFrames?.length) return undefined;
  return stackTrace.callFrames
    .map(f => `    at ${f.functionName || '<anonymous>'} (${f.url}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
    .join('\n');
}

async function toLogEntry(tabId, { method, params }) {
  if (method === 'Runtime.consoleAPICalled') {
    const level = TYPE_TO_LEVEL[params.type] || params.type;
    const args = [];
    for (const arg of params.args || []) {
      args.push(await serializeArg(tabId, arg));
    }
    const entry = {
      id: crypto.randomUUID(),
      level,
      args,
      timestamp: new Date(params.timestamp).toISOString()
    };
    if (level === 'error' || level === 'warn' || level === 'trace') {
      const stackTrace = formatStackTrace(params.stackTrace);
      if (stackTrace) entry.stackTrace = stackTrace;
    }
    return entry;
  }

  if (method === 'Runtime.exceptionThrown') {
    const details = params.exceptionDetails || {};
    const entry = {
      id: crypto.randomUUID(),
      level: 'error',
      args: [details.exception?.description || details.text || 'Uncaught exception'],
      timestamp: new Date(params.timestamp).toISOString()
    };
    const stackTrace = formatStackTrace(details.stackTrace);
    if (stackTrace) entry.stackTrace = stackTrace;
    return entry;
  }

  if (method === 'Log.entryAdded') {
    const e = params.entry || {};
    const level = e.level === 'warning' ? 'warn' : e.level === 'verbose' ? 'debug' : (e.level || 'log');
    return {
      id: crypto.randomUUID(),
      level,
      args: [e.url ? `${e.text} (${e.url})` : e.text],
      source: e.source, // network, security, violation, etc.
      timestamp: new Date(e.timestamp).toISOString()
    };
  }

  return null;
}

// Attach, enable Runtime + Log (which replays the page's buffered events),
// optionally keep listening for durationMs, then serialize while still attached.
async function collectConsoleEvents(tabId, durationMs) {
  const raw = [];
  const listener = (source, method, params) => {
    if (source.tabId !== tabId) return;
    if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown' || method === 'Log.entryAdded') {
      raw.push({ method, params });
    }
  };

  chrome.debugger.onEvent.addListener(listener);
  try {
    return await attachDebugger(tabId, async () => {
      const sendCmd = (cmd) => chrome.debugger.sendCommand({ tabId }, cmd);
      await sendCmd('Runtime.enable');
      await sendCmd('Log.enable');

      // Replayed events arrive while the enable commands process; for a plain
      // buffer read, a short settle window catches stragglers.
      await new Promise(resolve => setTimeout(resolve, durationMs > 0 ? durationMs : 100));

      // Serialize before detaching - object arguments need live objectIds
      const logs = [];
      for (const event of raw) {
        const entry = await toLogEntry(tabId, event);
        if (entry) logs.push(entry);
      }
      return logs;
    });
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
  }
}

export async function getLogs(tabState, { before, limit = 100, level } = {}) {
  const tabId = tabState.tabId;
  try {
    const all = await collectConsoleEvents(tabId, 0);
    all.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // newest first

    let logs = all;
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    if (before) {
      const beforeTimestamp = new Date(before).getTime();
      logs = logs.filter(log => new Date(log.timestamp).getTime() < beforeTimestamp);
    }

    const hasMore = logs.length > limit;
    return respondWith(tabState.tabId, {
      logs: logs.slice(0, limit),
      hasMore,
      totalCount: all.length
    });
  } catch (error) {
    return respondWithError(tabId, 'CONSOLE_LOG_ERROR', error.message);
  }
}

export async function watchConsole(tabState, { duration } = {}) {
  const tabId = tabState.tabId;
  if (!duration || duration <= 0) {
    return respondWithError(tabId, 'INVALID_TIMEOUT', 'watch_console requires a positive timeout');
  }

  try {
    const start = Date.now();
    const all = await collectConsoleEvents(tabId, duration);

    // Drop the replayed backlog - only keep events from the watch window
    const logs = all
      .filter(log => new Date(log.timestamp).getTime() >= start)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); // chronological

    return respondWith(tabId, { logs, watched: duration });
  } catch (error) {
    return respondWithError(tabId, 'WATCH_CONSOLE_ERROR', error.message);
  }
}

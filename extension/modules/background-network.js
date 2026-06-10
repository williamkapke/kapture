// Network monitoring via CDP (Chrome DevTools Protocol).
//
// Unlike the console, the Network domain does NOT replay history - Network.enable
// only emits events from the moment it is enabled forward, and the renderer only
// retains response bodies while the domain stays enabled. So monitoring is
// stateful: `networkMonitor({enabled:true})` attaches the debugger and keeps the
// Network domain enabled (holding one debugger ref) while requests accumulate
// into a per-tab buffer. `networkRequests` reads that buffer; `networkBody`
// fetches a single request/response body on demand (while still attached).
// Disabling detaches and clears the buffer.
//
// Enable/disable is idempotent per tab. Multiple MCP clients share a tab, but
// the SERVER tracks which clients want monitoring (it knows their identities)
// and only sends the final on/off here.

import { respondWith, acquireDebugger, releaseDebugger } from './background-commands.js';

const MAX_RECORDS = 2000; // ring buffer cap per tab; oldest dropped first

const monitors = new Map(); // tabId -> { seq, records: Map<requestId, record>, listener }

// respondWith decorates responses with tab info fetched from the content
// script - but some pages never run one (e.g. a streaming text/event-stream
// document). Network data lives in the background and is valid regardless,
// so degrade to an info-less response instead of failing the command.
async function respond(tabId, obj) {
  try {
    return await respondWith(tabId, obj);
  } catch (e) {
    return { success: !obj.error, ...obj };
  }
}

function respondError(tabId, code, message) {
  return respond(tabId, { error: { code, message } });
}

// If the debugger detaches out from under us (user dismisses the infobar, tab
// closes), drop the monitor so a later enable starts clean. The debugger ref is
// already gone, so there is nothing to release here.
chrome.debugger.onDetach.addListener((source) => {
  const monitor = monitors.get(source.tabId);
  if (!monitor) return;
  chrome.debugger.onEvent.removeListener(monitor.listener);
  monitors.delete(source.tabId);
});

function makeListener(tabId, monitor) {
  return (source, method, params) => {
    if (source.tabId !== tabId) return;

    if (method === 'Network.requestWillBeSent') {
      // Redirects reuse the requestId; we keep the final target (the common case
      // for "show me this request"). Intermediate redirect URLs collapse into it.
      let record = monitor.records.get(params.requestId);
      if (!record) {
        record = { requestId: params.requestId, seq: ++monitor.seq };
        monitor.records.set(params.requestId, record);
        // Evict the oldest once over the cap (Map preserves insertion order).
        if (monitor.records.size > MAX_RECORDS) {
          monitor.records.delete(monitor.records.keys().next().value);
        }
      }
      record.url = params.request.url;
      record.method = params.request.method;
      record.requestHeaders = params.request.headers;
      // Small POST bodies arrive inline; large ones only set the flag and are
      // fetched on demand via Network.getRequestPostData in networkBody.
      if (params.request.postData !== undefined) record.postData = params.request.postData;
      if (params.request.hasPostData || record.postData !== undefined) record.hasPostData = true;
      record.resourceType = (params.type || 'Other').toLowerCase();
      record.timestamp = params.wallTime ? new Date(params.wallTime * 1000).toISOString() : record.timestamp;
      record._tStart = params.timestamp;
      return;
    }

    const record = monitor.records.get(params.requestId);
    if (!record) return;

    if (method === 'Network.responseReceived') {
      record.status = params.response.status;
      record.statusText = params.response.statusText;
      record.mimeType = params.response.mimeType;
      record.responseHeaders = params.response.headers;
      record.fromCache = params.response.fromDiskCache || params.response.fromServiceWorker || false;
      if (params.type) record.resourceType = params.type.toLowerCase();
    } else if (method === 'Network.loadingFinished') {
      record.finished = true;
      record.size = params.encodedDataLength;
      if (record._tStart !== undefined) record.durationMs = Math.round((params.timestamp - record._tStart) * 1000);
    } else if (method === 'Network.loadingFailed') {
      record.finished = true;
      record.failed = true;
      record.errorText = params.errorText;
      record.canceled = params.canceled || false;
      record.resourceType = (params.type || record.resourceType || 'other').toLowerCase();
    }
  };
}

// Strip a record to the lean metadata shape returned in the list.
function toPublic(r) {
  const out = {
    requestId: r.requestId,
    seq: r.seq,
    url: r.url,
    method: r.method,
    resourceType: r.resourceType,
    timestamp: r.timestamp
  };
  if (r.hasPostData) out.hasPostData = true;
  if (r.status !== undefined) out.status = r.status;
  if (r.statusText) out.statusText = r.statusText;
  if (r.mimeType) out.mimeType = r.mimeType;
  if (r.size !== undefined) out.size = r.size;
  if (r.fromCache) out.fromCache = true;
  if (r.durationMs !== undefined) out.durationMs = r.durationMs;
  if (r.failed) {
    out.failed = true;
    out.errorText = r.errorText;
    if (r.canceled) out.canceled = true;
  }
  return out;
}

// Tear down a tab's monitor (no-op if not monitoring). Used by networkMonitor
// and by the tab manager when the tab's server connection drops - without that,
// a server restart would orphan a running monitor nobody can turn off.
export async function stopNetworkMonitor(tabId) {
  const monitor = monitors.get(tabId);
  if (!monitor) return;
  chrome.debugger.onEvent.removeListener(monitor.listener);
  monitors.delete(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Network.disable');
  } catch (e) { /* tab/debugger may already be gone */ }
  await releaseDebugger(tabId);
}

export async function networkMonitor(tabState, { enabled } = {}) {
  const tabId = tabState.tabId;
  if (typeof enabled !== 'boolean') {
    return respondError(tabId, 'INVALID_ARG', 'network_monitor requires `enabled` (boolean)');
  }

  let monitor = monitors.get(tabId);

  if (enabled && !monitor) {
    monitor = { seq: 0, records: new Map(), listener: null };
    monitor.listener = makeListener(tabId, monitor);
    chrome.debugger.onEvent.addListener(monitor.listener);
    try {
      await acquireDebugger(tabId);
    } catch (e) {
      chrome.debugger.onEvent.removeListener(monitor.listener);
      return respondError(tabId, 'MONITOR_START_ERROR', e.message);
    }
    try {
      // Generous buffers so response bodies stay retained for later body fetches.
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
        maxResourceBufferSize: 10 * 1024 * 1024,
        maxTotalBufferSize: 100 * 1024 * 1024
      });
    } catch (e) {
      chrome.debugger.onEvent.removeListener(monitor.listener);
      await releaseDebugger(tabId);
      return respondError(tabId, 'MONITOR_START_ERROR', e.message);
    }
    monitors.set(tabId, monitor);
  } else if (!enabled && monitor) {
    await stopNetworkMonitor(tabId);
    monitor = null;
  }

  return respond(tabId, {
    monitoring: !!monitor,
    bufferedCount: monitor ? monitor.records.size : 0
  });
}

export async function networkRequests(tabState, { since = 0, limit = 50 } = {}) {
  const tabId = tabState.tabId;
  const monitor = monitors.get(tabId);
  if (!monitor) {
    return respond(tabId, { monitoring: false, requests: [], cursor: since, hasMore: false, totalBuffered: 0 });
  }

  const matching = [...monitor.records.values()]
    .filter(r => r.seq > since)
    .sort((a, b) => a.seq - b.seq);

  const page = matching.slice(0, limit);
  const requests = page.map(toPublic);

  return respond(tabId, {
    monitoring: true,
    requests,
    cursor: requests.length ? requests[requests.length - 1].seq : since,
    hasMore: matching.length > page.length,
    totalBuffered: monitor.records.size
  });
}

// Real byte length of a base64 payload (minus padding).
function base64ByteLength(b64) {
  if (!b64) return 0;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor(b64.length * 3 / 4) - padding;
}

export async function networkBody(tabState, { requestId, maxBytes = 65536 } = {}) {
  const tabId = tabState.tabId;
  if (!requestId) {
    return respondError(tabId, 'INVALID_ARG', 'network_body requires `requestId`');
  }
  const monitor = monitors.get(tabId);
  if (!monitor) {
    return respondError(tabId, 'NOT_MONITORING', 'Network monitoring is not enabled for this tab. Enable it with network_monitor first.');
  }

  const record = monitor.records.get(requestId);
  const meta = record ? {
    url: record.url,
    method: record.method,
    status: record.status,
    mimeType: record.mimeType,
    resourceType: record.resourceType,
    requestHeaders: record.requestHeaders,
    responseHeaders: record.responseHeaders
  } : {};

  const out = { requestId, ...meta };

  // Request payload (POST/PUT body). Small bodies arrived inline with
  // requestWillBeSent; larger ones are fetched on demand while attached.
  if (record?.hasPostData) {
    let postData = record.postData;
    if (postData === undefined) {
      try {
        const r = await chrome.debugger.sendCommand({ tabId }, 'Network.getRequestPostData', { requestId });
        postData = r.postData;
      } catch (e) {
        out.requestBodyError = e.message; // no longer retained
      }
    }
    if (postData !== undefined) {
      const bytes = new TextEncoder().encode(postData);
      if (bytes.length > maxBytes) {
        out.requestBody = new TextDecoder().decode(bytes.slice(0, maxBytes));
        out.requestBodyTruncated = true;
      } else {
        out.requestBody = postData;
      }
      out.requestBodySize = bytes.length;
    }
  }

  // Response body. Needs the domain still enabled (it is, while monitoring) AND
  // the body still retained by the renderer - it may have been evicted on a busy
  // page or discarded when the page navigated, which surfaces as bodyError.
  try {
    const res = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', { requestId });
    const raw = res.body || '';
    let body = raw;
    let truncated = false;
    let size;

    if (res.base64Encoded) {
      size = base64ByteLength(raw);
      // Slice on a 3-byte boundary so the truncated payload stays valid base64.
      const maxB64Chars = Math.ceil(maxBytes / 3) * 4;
      if (raw.length > maxB64Chars) {
        body = raw.slice(0, maxB64Chars);
        truncated = true;
      }
    } else {
      const bytes = new TextEncoder().encode(raw);
      size = bytes.length;
      if (bytes.length > maxBytes) {
        body = new TextDecoder().decode(bytes.slice(0, maxBytes));
        truncated = true;
      }
    }

    out.base64Encoded = !!res.base64Encoded;
    out.size = size;
    if (truncated) out.bodyTruncated = true;
    out.body = body;
  } catch (e) {
    // Label the known-unreadable cases instead of the generic CDP error.
    if (record && (record.mimeType === 'text/event-stream' || record.resourceType === 'eventsource')) {
      out.bodyError = 'Streaming response (text/event-stream) - CDP does not retain streaming bodies, so they cannot be read.';
    } else if (record && !record.finished) {
      out.bodyError = 'Response is still in flight - the body can only be read after the request finishes.';
    } else {
      out.bodyError = e.message;
    }
  }

  return respond(tabId, out);
}

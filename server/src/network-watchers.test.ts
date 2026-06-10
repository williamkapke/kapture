import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCommandHandler } from './browser-command-handler.js';

// Unit tests for the network-monitoring watcher registry: watchers are
// tracked per caller identity (MCP connection id or HTTP clientId), enable
// is idempotent per watcher, monitoring turns off with the last watcher
// (or force), and a disconnecting client releases its watchers.
//
// The fakes stand in for the extension round-trip: the websocket manager
// echoes every forwarded command back as a successful extension response,
// and records what was forwarded so tests can assert when the extension
// was (or wasn't) told to flip monitoring.
function makeHandler() {
  const sent: any[] = [];
  let nextResult: any = null;

  const manager = {
    sendCommand(_tabId: string, msg: any) {
      sent.push(msg);
      const result = nextResult ?? { success: true, monitoring: msg.params.enabled, bufferedCount: 0 };
      nextResult = null;
      queueMicrotask(() => handler.handleCommandResponse({ id: msg.id, success: true, result }));
    }
  };
  const registry = {
    get(tabId: string) {
      if (tabId === 'tab1') return { version: '1.1.0' };
      if (tabId === 'old-tab') return { version: '1.0.0' };
      return undefined;
    }
  };

  const handler = new BrowserCommandHandler(manager as any, registry as any);
  return {
    handler,
    sent,
    setNextResult: (r: any) => { nextResult = r; },
    monitor: (args: any, callerId?: string) => handler.callTool('network_monitor', { tabId: 'tab1', ...args }, callerId)
  };
}

test('enable is idempotent per watcher', async () => {
  const { monitor } = makeHandler();

  let result = await monitor({ enabled: true }, 'client-1');
  assert.equal(result.watchers, 1);

  result = await monitor({ enabled: true }, 'client-1');
  assert.equal(result.watchers, 1); // same caller, not double-counted
  assert.equal(result.monitoring, true);
});

test('monitoring stays on until the last watcher disables', async () => {
  const { monitor, sent } = makeHandler();

  await monitor({ enabled: true }, 'client-1');
  const both = await monitor({ enabled: true }, 'client-2');
  assert.equal(both.watchers, 2);

  const oneLeft = await monitor({ enabled: false }, 'client-1');
  assert.equal(oneLeft.monitoring, true);
  assert.equal(oneLeft.watchers, 1);
  // No disable was forwarded to the extension - client-2 still watches
  assert.equal(sent.filter(m => m.params.enabled === false).length, 0);

  const off = await monitor({ enabled: false }, 'client-2');
  assert.equal(off.monitoring, false);
  assert.equal(off.watchers, 0);
  assert.equal(sent.filter(m => m.params.enabled === false).length, 1);
});

test('force disables regardless of remaining watchers', async () => {
  const { monitor, sent } = makeHandler();

  await monitor({ enabled: true }, 'client-1');
  await monitor({ enabled: true }, 'client-2');

  const off = await monitor({ enabled: false, force: true }, 'client-3');
  assert.equal(off.monitoring, false);
  assert.equal(off.watchers, 0);
  assert.equal(sent.filter(m => m.params.enabled === false).length, 1);
});

test('clientId overrides the caller identity (HTTP callers)', async () => {
  const { monitor } = makeHandler();

  // Different connections using the same clientId are the same watcher
  await monitor({ enabled: true, clientId: 'shared' }, 'conn-A');
  const off = await monitor({ enabled: false, clientId: 'shared' }, 'conn-B');
  assert.equal(off.monitoring, false);
  assert.equal(off.watchers, 0);
});

test('callers without identity share the http watcher', async () => {
  const { monitor } = makeHandler();

  await monitor({ enabled: true }); // no callerId, no clientId -> 'http'
  const result = await monitor({ enabled: true });
  assert.equal(result.watchers, 1);

  const off = await monitor({ enabled: false });
  assert.equal(off.monitoring, false);
});

test('releaseNetworkWatchers turns monitoring off for a disconnected last watcher', async () => {
  const { handler, monitor, sent } = makeHandler();

  await monitor({ enabled: true }, 'client-1');
  await monitor({ enabled: true }, 'client-2');

  handler.releaseNetworkWatchers('client-1');
  // client-2 still watching - nothing forwarded
  assert.equal(sent.filter(m => m.params.enabled === false).length, 0);

  handler.releaseNetworkWatchers('client-2');
  await new Promise(resolve => setImmediate(resolve)); // let the async disable settle
  assert.equal(sent.filter(m => m.params.enabled === false).length, 1);
});

test('a failed enable rolls the watcher back', async () => {
  const { monitor, setNextResult } = makeHandler();

  setNextResult({ success: false, error: { code: 'MONITOR_START_ERROR', message: 'attach failed' } });
  const failed = await monitor({ enabled: true }, 'client-1');
  assert.equal(failed.success, false);

  // The phantom watcher from the failed enable must not linger
  const result = await monitor({ enabled: true }, 'client-2');
  assert.equal(result.watchers, 1);
});

test('clearNetworkWatchersForTab forgets all watchers', async () => {
  const { handler, monitor } = makeHandler();

  await monitor({ enabled: true }, 'client-1');
  await monitor({ enabled: true }, 'client-2');
  handler.clearNetworkWatchersForTab('tab1');

  const result = await monitor({ enabled: true }, 'client-3');
  assert.equal(result.watchers, 1); // fresh registry, not 3
});

test('outdated extension is rejected, missing tab reports not found', async () => {
  const { handler } = makeHandler();

  const outdated = await handler.callTool('network_monitor', { tabId: 'old-tab', enabled: true }, 'client-1');
  assert.equal(outdated.success, false);
  assert.equal(outdated.error.code, 'EXTENSION_OUTDATED');

  await assert.rejects(
    handler.callTool('network_monitor', { tabId: 'gone-tab', enabled: true }, 'client-1'),
    /Tab gone-tab not found/
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserCommandHandler } from './browser-command-handler.js';

// Coordinate click/hover (x/y) landed in extension 1.2.0. The server gates
// the coordinate mode - not the tools - so selector targeting keeps working
// against older extensions while x/y reports EXTENSION_OUTDATED instead of
// the misleading "selector or xpath required" an old extension would return.
function makeHandler() {
  const sent: any[] = [];

  const manager = {
    sendCommand(_tabId: string, msg: any) {
      sent.push(msg);
      queueMicrotask(() => handler.handleCommandResponse({
        id: msg.id,
        success: true,
        result: { success: true, clicked: true }
      }));
    }
  };
  const registry = {
    get(tabId: string) {
      if (tabId === 'new-tab') return { version: '1.2.0' };
      if (tabId === 'old-tab') return { version: '1.1.0' };
      return undefined;
    }
  };

  const handler = new BrowserCommandHandler(manager as any, registry as any);
  return { handler, sent };
}

test('coordinate clicks pass through on extension 1.2.0', async () => {
  const { handler, sent } = makeHandler();

  const result = await handler.callTool('click', { tabId: 'new-tab', x: 10, y: 20 });
  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
});

test('coordinate click/hover on an older extension reports EXTENSION_OUTDATED', async () => {
  const { handler, sent } = makeHandler();

  for (const tool of ['click', 'hover']) {
    const result = await handler.callTool(tool, { tabId: 'old-tab', x: 10, y: 20 });
    assert.equal(result.success, false);
    assert.equal(result.error.code, 'EXTENSION_OUTDATED');
  }
  assert.equal(sent.length, 0); // nothing was forwarded to the extension
});

test('selector clicks still pass through on an older extension', async () => {
  const { handler, sent } = makeHandler();

  const result = await handler.callTool('click', { tabId: 'old-tab', selector: '#a' });
  assert.equal(result.success, true);
  assert.equal(sent.length, 1);
});

test('a coordinate click on an unknown tab is not masked as outdated', async () => {
  const { handler } = makeHandler();

  await assert.rejects(
    handler.callTool('click', { tabId: 'gone-tab', x: 10, y: 20 }),
    /Tab gone-tab not found/
  );
});

test('dialog passes through on extension 1.2.0 and is gated below it', async () => {
  const { handler, sent } = makeHandler();

  const result = await handler.callTool('dialog', { tabId: 'new-tab', accept: true });
  assert.equal(result.success, true);
  assert.equal(sent.length, 1);

  const outdated = await handler.callTool('dialog', { tabId: 'old-tab', accept: true });
  assert.equal(outdated.success, false);
  assert.equal(outdated.error.code, 'EXTENSION_OUTDATED');
  assert.equal(sent.length, 1); // nothing further forwarded
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { probe, waitForPort } from './bridge-lib.js';

test('waitForPort fails fast within its timeout budget when the server never comes up', async () => {
  // Regression guard for issue #7: when the spawned server never binds the
  // port, the bridge must give up within its window instead of hanging ~60s
  // on a WebSocket connect that never succeeds.
  const start = Date.now();
  const ok = await waitForPort('127.0.0.1', 0, {
    probeFn: async () => false,
    timeoutMs: 1000,
    stepMs: 100,
  });
  const elapsed = Date.now() - start;

  assert.equal(ok, false);
  assert.ok(elapsed >= 1000, `gave up before the timeout budget (${elapsed}ms)`);
  assert.ok(elapsed < 3000, `took far longer than the timeout budget (${elapsed}ms)`);
});

test('waitForPort resolves immediately once a probe succeeds', async () => {
  const start = Date.now();
  const ok = await waitForPort('127.0.0.1', 0, {
    probeFn: async () => true,
    timeoutMs: 5000,
    stepMs: 250,
  });

  assert.equal(ok, true);
  assert.ok(Date.now() - start < 250, 'should not wait when the first probe succeeds');
});

test('probe returns true for a listening port and false once it is closed', async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as net.AddressInfo;

  assert.equal(await probe('127.0.0.1', port), true, 'listening port should be reachable');

  await new Promise<void>((resolve) => server.close(() => resolve()));

  assert.equal(await probe('127.0.0.1', port), false, 'closed port should be unreachable');
});

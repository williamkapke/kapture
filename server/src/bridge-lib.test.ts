import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import { probe, waitForPort, ensureServer, canSpawnDetachedServer } from './bridge-lib.js';

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

test('ensureServer reuses an already-running server without spawning or hosting in-process', async () => {
  let spawned = false;
  let inProcess = false;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => true,
    waitFn: async () => {
      throw new Error('waitForPort should not run when a server is already up');
    },
    spawnDetached: () => {
      spawned = true;
    },
    startInProcess: async () => {
      inProcess = true;
    },
  });

  assert.equal(outcome, 'already-running');
  assert.equal(spawned, false, 'must not spawn when a server is already listening');
  assert.equal(inProcess, false, 'must not host in-process when a server is already listening');
});

test('ensureServer uses the detached spawn when it successfully binds the port', async () => {
  let inProcess = false;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => false,
    waitFn: async () => true, // the spawned child bound the port
    spawnDetached: () => {},
    startInProcess: async () => {
      inProcess = true;
    },
  });

  assert.equal(outcome, 'spawned');
  assert.equal(inProcess, false, 'must not host in-process when the detached child works');
});

test('ensureServer falls back to in-process hosting when the detached child never binds (issue #13)', async () => {
  // Reproduces "Unable to connect to extension server": under a host whose
  // bundled Node cannot keep a detached child alive (e.g. Claude Desktop's
  // runtime), the spawned server never binds the port. The bridge must then
  // host the server inside its own process instead of giving up with exit(1).
  let inProcessStarted = false;
  let waitCalls = 0;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => false,
    waitFn: async () => {
      waitCalls += 1;
      // First wait (after the detached spawn) fails; second wait (after the
      // in-process start) succeeds.
      return waitCalls >= 2;
    },
    spawnDetached: () => {},
    startInProcess: async () => {
      inProcessStarted = true;
    },
  });

  assert.equal(inProcessStarted, true, 'must host the server in-process when the detached child never binds');
  assert.equal(outcome, 'in-process');
});

test('ensureServer still falls back to in-process hosting when the detached spawn itself throws', async () => {
  // spawnDetached is best-effort: a throw (e.g. failing to open the spawn log)
  // must not abort the guaranteed in-process fallback.
  let inProcessStarted = false;
  let waitCalls = 0;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => false,
    waitFn: async () => {
      waitCalls += 1;
      return waitCalls >= 2;
    },
    spawnDetached: () => {
      throw new Error('EACCES: cannot open spawn log');
    },
    startInProcess: async () => {
      inProcessStarted = true;
    },
  });

  assert.equal(inProcessStarted, true, 'a throwing detached spawn must not skip the in-process fallback');
  assert.equal(outcome, 'in-process');
});

test('ensureServer hosts in-process directly when no spawnDetached is given', async () => {
  // The bridge omits spawnDetached under Electron hosts (e.g. Claude Desktop):
  // a detached child cannot survive there, and the host's process monitor
  // prompts the user about the spawned file. There must be no spawn attempt
  // and no spawn-wait; the first (and only) wait is for the in-process server.
  let inProcessStarted = false;
  let waitCalls = 0;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => false,
    waitFn: async () => {
      waitCalls += 1;
      return true;
    },
    startInProcess: async () => {
      inProcessStarted = true;
    },
  });

  assert.equal(outcome, 'in-process');
  assert.equal(inProcessStarted, true);
  assert.equal(waitCalls, 1, 'must not spend a wait window on a spawn that never happened');
});

test('ensureServer still reuses an already-running server when no spawnDetached is given', async () => {
  let inProcess = false;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => true,
    waitFn: async () => {
      throw new Error('waitForPort should not run when a server is already up');
    },
    startInProcess: async () => {
      inProcess = true;
    },
  });

  assert.equal(outcome, 'already-running');
  assert.equal(inProcess, false, 'must not host in-process when a server is already listening');
});

test('ensureServer reports failure when neither the detached child nor in-process hosting binds', async () => {
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => false,
    waitFn: async () => false, // never binds, even after the in-process start
    spawnDetached: () => {},
    startInProcess: async () => {},
  });

  assert.equal(outcome, 'failed');
});

test('ensureServer reports failure when in-process hosting throws', async () => {
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => false,
    waitFn: async () => false,
    spawnDetached: () => {},
    startInProcess: async () => {
      throw new Error('in-process start failed');
    },
  });

  assert.equal(outcome, 'failed');
});

test('ensureServer treats an in-process EADDRINUSE as success when a racing child won the port', async () => {
  // A slow detached child can bind the port just as the in-process listen
  // fires, throwing EADDRINUSE. The server is still up, so this must not fail.
  let probeCalls = 0;
  const outcome = await ensureServer({
    host: '127.0.0.1',
    port: 61822,
    probeFn: async () => {
      probeCalls += 1;
      // First probe (step 1): nothing up yet. Probe after the throw: the racing
      // child has now bound the port.
      return probeCalls > 1;
    },
    waitFn: async () => false, // the detached child hadn't bound within the window
    spawnDetached: () => {},
    startInProcess: async () => {
      throw new Error('listen EADDRINUSE 127.0.0.1:61822');
    },
  });

  assert.equal(outcome, 'already-running');
});

// --- canSpawnDetachedServer (issues #15, #24) -------------------------------
// Only a plain `node` may spawn the detached child. Desktop hosts watch the
// file it is handed and prompt "Attach 'index.js' to this session?" on every
// launch and view change, so they get the in-process server instead.

const plainNode = { versions: {}, env: {}, execPath: String.raw`C:\Program Files\nodejs\node.exe` };

test('canSpawnDetachedServer allows a plain node runtime', () => {
  assert.equal(canSpawnDetachedServer(plainNode), true);
  assert.equal(
    canSpawnDetachedServer({ versions: {}, env: {}, execPath: '/usr/local/bin/node' }),
    true
  );
});

test('canSpawnDetachedServer refuses Electron hosts', () => {
  assert.equal(canSpawnDetachedServer({ ...plainNode, versions: { electron: '31.0.0' } }), false);
});

test('canSpawnDetachedServer refuses a host that launched us as Electron-as-node', () => {
  assert.equal(canSpawnDetachedServer({ ...plainNode, env: { ELECTRON_RUN_AS_NODE: '1' } }), false);
});

test('canSpawnDetachedServer refuses a packaged runtime not named node', () => {
  assert.equal(
    canSpawnDetachedServer({
      ...plainNode,
      execPath: String.raw`C:\Program Files\WindowsApps\Claude.exe`,
    }),
    false
  );
});

test("canSpawnDetachedServer refuses a node bundled inside a desktop host's own directory", () => {
  // Claude Desktop's built-in Node: named node.exe, but shipped with the app
  assert.equal(
    canSpawnDetachedServer({
      ...plainNode,
      execPath: String.raw`C:\Users\me\AppData\Local\AnthropicClaude\app-1.0.0\node.exe`,
    }),
    false
  );
  assert.equal(
    canSpawnDetachedServer({
      ...plainNode,
      execPath: '/Applications/Claude.app/Contents/Resources/node',
    }),
    false
  );
});

test('canSpawnDetachedServer honours the KAPTURE_DETACHED_SERVER override both ways', () => {
  assert.equal(
    canSpawnDetachedServer({ ...plainNode, env: { KAPTURE_DETACHED_SERVER: '0' } }),
    false
  );
  assert.equal(
    canSpawnDetachedServer({
      versions: { electron: '31.0.0' },
      env: { KAPTURE_DETACHED_SERVER: '1' },
      execPath: String.raw`C:\Program Files\WindowsApps\Claude.exe`,
    }),
    true
  );
});

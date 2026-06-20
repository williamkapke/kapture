import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

// Integration tests for the control-plane security wiring in index.ts: the HTTP
// handler and the WebSocket upgrade gate, exercised over a real socket. The
// pure allow-list logic is unit-tested in origin-policy.test.ts; these tests
// guard the wiring (right header, right status, check in the right place) that
// unit tests can't see.

// A free, non-default port so the test never collides with a running server.
// Must be set before importing index.ts, which reads it at module load.
const PORT = 61999;
process.env.KAPTURE_PORT = String(PORT);

const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;
const EXT = 'chrome-extension://ejfnegenodbdcodemkibocefmajjjjbn'; // the Kapture extension
const GOOD = 'https://williamkapke.github.io';                     // allow-listed
const EVIL = 'https://evil.example';

let startServer: () => Promise<void>;
let stopServer: () => Promise<void>;

before(async () => {
  ({ startServer, stopServer } = await import('./index.js'));
  await startServer();
});

after(async () => {
  await stopServer();
});

// Resolve to the HTTP status of a WS upgrade attempt: 101 if accepted, or the
// rejection code (e.g. 403). Closes the socket so no handle leaks.
function wsStatus(path: string, origin?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_BASE + path, origin ? { origin } : undefined);
    const done = (code: number) => { try { ws.close(); } catch { /* */ } resolve(code); };
    ws.on('open', () => done(101));
    ws.on('unexpected-response', (_req, res) => { ws.terminate(); resolve(res.statusCode || 0); });
    ws.on('error', (err: any) => {
      const m = String(err && err.message).match(/4\d\d/);
      if (m) resolve(Number(m[0]));
      else reject(err);
    });
  });
}

// ---- HTTP ------------------------------------------------------------------

test('HTTP: hostile origin is rejected with 403 and no ACAO header', async () => {
  const res = await fetch(`${BASE}/clients`, { headers: { Origin: EVIL } });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('HTTP: allow-listed origin gets its Origin reflected (never a wildcard)', async () => {
  const res = await fetch(`${BASE}/clients`, { headers: { Origin: GOOD } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), GOOD);
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('vary') || '', /Origin/);
});

test('HTTP: no-Origin local tooling is allowed', async () => {
  const res = await fetch(`${BASE}/clients`);
  assert.equal(res.status, 200);
});

test('HTTP preflight: allow-listed OPTIONS returns 204 with CORS + PNA headers', async () => {
  const res = await fetch(`${BASE}/clients`, { method: 'OPTIONS', headers: { Origin: GOOD } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), GOOD);
  // Regression guard: methods/headers must survive on the preflight response,
  // else legit dashboard preflights break.
  assert.match(res.headers.get('access-control-allow-methods') || '', /POST/);
  assert.ok(res.headers.get('access-control-allow-headers'));
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});

test('HTTP preflight: hostile OPTIONS is rejected with 403', async () => {
  const res = await fetch(`${BASE}/clients`, { method: 'OPTIONS', headers: { Origin: EVIL } });
  assert.equal(res.status, 403);
});

// ---- WebSocket upgrade -----------------------------------------------------

test('WS: hostile origin upgrade is rejected (no 101)', async () => {
  assert.notEqual(await wsStatus('/', EVIL), 101);
});

test('WS: extension origin is accepted on the root path', async () => {
  assert.equal(await wsStatus('/', EXT), 101);
});

test('WS: extension origin is rejected on /mcp', async () => {
  assert.notEqual(await wsStatus('/mcp', EXT), 101);
});

test('WS: no-Origin client (the bridge) is accepted on /mcp', async () => {
  assert.equal(await wsStatus('/mcp'), 101);
});

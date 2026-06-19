import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, isWebSocketOriginAllowed, parseAllowedOrigins } from './origin-policy.js';

// Tests for the control-plane Origin allow-list (origin-policy.ts).

test('non-browser callers (no Origin) are allowed - scripts, bridge, curl', () => {
  assert.equal(isOriginAllowed(undefined), true);
});

test('the extension (chrome-extension://) is allowed', () => {
  assert.equal(isOriginAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop'), true);
});

test('allow-listed web origins are allowed', () => {
  assert.equal(isOriginAllowed('https://williamkapke.github.io'), true); // hosted dashboard
  assert.equal(isOriginAllowed('http://127.0.0.1:61822'), true);         // server-hosted test.html
  assert.equal(isOriginAllowed('http://localhost:61822'), true);
});

test('hostile / unknown web origins are rejected', () => {
  assert.equal(isOriginAllowed('https://evil.com'), false);
  assert.equal(isOriginAllowed('http://evil.com'), false);
  assert.equal(isOriginAllowed('https://williamkapke.github.io.evil.com'), false);
  assert.equal(isOriginAllowed('http://localhost:8080'), false); // not on the default list
});

test('an Origin of "null" is rejected', () => {
  assert.equal(isOriginAllowed('null'), false);
});

test('a duplicated Origin header (array) is rejected', () => {
  assert.equal(isOriginAllowed(['https://williamkapke.github.io', 'https://evil.com']), false);
});

// The WebSocket gate adds one path-scoped rule on top of isOriginAllowed: the
// extension's chrome-extension:// origin is accepted on the root path (where it
// connects) but not on /mcp (only no-Origin MCP clients use that path).
test('WS: extension origin is accepted on root but rejected on /mcp', () => {
  const ext = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
  assert.equal(isWebSocketOriginAllowed('/', ext), true);
  assert.equal(isWebSocketOriginAllowed('/mcp', ext), false);
});

test('WS: no-Origin clients (the bridge / scripts) are accepted on /mcp', () => {
  assert.equal(isWebSocketOriginAllowed('/mcp', undefined), true);
  assert.equal(isWebSocketOriginAllowed('/', undefined), true);
});

test('WS: allow-listed web origins pass, hostile ones are rejected, on both paths', () => {
  for (const path of ['/', '/mcp']) {
    assert.equal(isWebSocketOriginAllowed(path, 'https://williamkapke.github.io'), true);
    assert.equal(isWebSocketOriginAllowed(path, 'https://evil.com'), false);
  }
});

test('KAPTURE_ALLOWED_ORIGINS extends the allow-list', () => {
  const allowed = parseAllowedOrigins('http://localhost:8080, https://my.dashboard');
  assert.equal(isOriginAllowed('http://localhost:8080', allowed), true);
  assert.equal(isOriginAllowed('https://my.dashboard', allowed), true);
  assert.equal(isOriginAllowed('https://evil.com', allowed), false);
  // defaults still present
  assert.equal(isOriginAllowed('https://williamkapke.github.io', allowed), true);
});

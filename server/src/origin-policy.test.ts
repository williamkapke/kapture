import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOriginAllowed, isWebSocketOriginAllowed, parseAllowedOrigins, isAssistantsReadOrigin, isAssistantsWriteOrigin } from './origin-policy.js';

// Tests for the control-plane Origin allow-list (origin-policy.ts).

const EXT = 'chrome-extension://ejfnegenodbdcodemkibocefmajjjjbn';
const OTHER_EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

test('non-browser callers (no Origin) are allowed - scripts, bridge, curl', () => {
  assert.equal(isOriginAllowed(undefined), true);
});

test('the general gate (HTTP) rejects all chrome-extension origins', () => {
  // The extension makes no HTTP calls; it is accepted only on the root WS.
  assert.equal(isOriginAllowed(EXT), false);
  assert.equal(isOriginAllowed(OTHER_EXT), false);
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

// The extension's one channel is the root WebSocket. A chrome-extension origin is
// accepted there and nowhere else - not on /mcp, not on HTTP.
test('WS root: a chrome-extension origin is accepted', () => {
  assert.equal(isWebSocketOriginAllowed('/', EXT), true);
  assert.equal(isWebSocketOriginAllowed('/', OTHER_EXT), true);
});

test('WS /mcp: no chrome-extension origin is accepted', () => {
  assert.equal(isWebSocketOriginAllowed('/mcp', EXT), false);
  assert.equal(isWebSocketOriginAllowed('/mcp', OTHER_EXT), false);
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

// The /assistants endpoints are reachable only from the welcome page's origins -
// a present, browser-set Origin - so no-Origin scripts/curl can't reach them.
test('assistants read: welcome-page origins only (localhost + GitHub Pages)', () => {
  assert.equal(isAssistantsReadOrigin('http://localhost:61822'), true);
  assert.equal(isAssistantsReadOrigin('http://127.0.0.1:61822'), true);
  assert.equal(isAssistantsReadOrigin('https://williamkapke.github.io'), true); // localhost probe
  assert.equal(isAssistantsReadOrigin(undefined), false);                       // no-Origin script/curl
  assert.equal(isAssistantsReadOrigin('https://evil.com'), false);
});

test('assistants write: localhost only (not GitHub Pages, not no-Origin)', () => {
  assert.equal(isAssistantsWriteOrigin('http://localhost:61822'), true);
  assert.equal(isAssistantsWriteOrigin('http://127.0.0.1:61822'), true);
  assert.equal(isAssistantsWriteOrigin('https://williamkapke.github.io'), false); // probe-and-redirect only
  assert.equal(isAssistantsWriteOrigin(undefined), false);
  assert.equal(isAssistantsWriteOrigin('https://evil.com'), false);
});

test('KAPTURE_ALLOWED_ORIGINS extends the allow-list', () => {
  const allowed = parseAllowedOrigins('http://localhost:8080, https://my.dashboard');
  assert.equal(isOriginAllowed('http://localhost:8080', allowed), true);
  assert.equal(isOriginAllowed('https://my.dashboard', allowed), true);
  assert.equal(isOriginAllowed('https://evil.com', allowed), false);
  // defaults still present
  assert.equal(isOriginAllowed('https://williamkapke.github.io', allowed), true);
});

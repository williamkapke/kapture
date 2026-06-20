// Origin allow-list for the local control plane (HTTP + WebSocket), enforced in
// index.ts on both the HTTP handler and the WebSocket upgrade. No Origin = a
// non-browser caller (script, curl, the bridge) and is allowed; the extension's
// chrome-extension:// origin is allowed; any other Origin must be on the list.

const DEFAULT_ALLOWED_ORIGINS = [
  'https://williamkapke.github.io', // hosted dashboard (clients.html)
  'http://127.0.0.1:61822',         // server-hosted test.html (same-origin)
  'http://localhost:61822',
];

// Extra origins for self-hosted dashboards / local website development, e.g.
// KAPTURE_ALLOWED_ORIGINS="http://localhost:8080,https://my.dashboard"
export function parseAllowedOrigins(
  env: string | undefined = process.env.KAPTURE_ALLOWED_ORIGINS,
): Set<string> {
  return new Set([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(env || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  ]);
}

const ALLOWED_ORIGINS = parseAllowedOrigins();

// The published Web Store build's extension ID. Pinning to it means a *different*
// installed extension cannot drive Kapture just by virtue of being an extension.
// A self-built / dev-loaded extension gets a different ID, so allow extra IDs via
// KAPTURE_EXTENSION_IDS="aaaa...,bbbb..." for that case.
const DEFAULT_EXTENSION_IDS = [
  'ejfnegenodbdcodemkibocefmajjjjbn', // Kapture MCP Browser Automation (Web Store)
];

export function parseExtensionIds(
  env: string | undefined = process.env.KAPTURE_EXTENSION_IDS,
): Set<string> {
  return new Set([
    ...DEFAULT_EXTENSION_IDS,
    ...(env || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  ]);
}

const ALLOWED_EXTENSION_IDS = parseExtensionIds();

const isExtensionOrigin = (
  origin: string | string[] | undefined,
  ids: Set<string> = ALLOWED_EXTENSION_IDS,
): boolean =>
  typeof origin === 'string' &&
  origin.startsWith('chrome-extension://') &&
  ids.has(origin.slice('chrome-extension://'.length));

export function isOriginAllowed(
  origin: string | string[] | undefined,
  allowed: Set<string> = ALLOWED_ORIGINS,
): boolean {
  if (origin === undefined) return true;        // non-browser caller
  if (typeof origin !== 'string') return false; // duplicated header
  if (isExtensionOrigin(origin)) return true;   // the extension
  return allowed.has(origin);
}

// WebSocket upgrade gate. The extension connects on the root path; no legitimate
// extension uses /mcp (only the bridge and other MCP clients, which send no
// Origin), so a chrome-extension:// origin is not accepted there.
export function isWebSocketOriginAllowed(
  pathname: string,
  origin: string | string[] | undefined,
  allowed: Set<string> = ALLOWED_ORIGINS,
): boolean {
  if (!isOriginAllowed(origin, allowed)) return false;
  if (pathname === '/mcp' && isExtensionOrigin(origin)) return false;
  return true;
}

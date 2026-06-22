// Origin allow-list for the local control plane (HTTP + WebSocket), enforced in
// index.ts on the HTTP handler and the WebSocket upgrade. No Origin = a
// non-browser caller (script, curl, the bridge) and is allowed; a web Origin
// must be on the allow-list. The extension connects only via the root WebSocket,
// so its chrome-extension:// origin is accepted only there - not on HTTP, not on /mcp.

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

const isExtensionOrigin = (origin: string | string[] | undefined): boolean =>
  typeof origin === 'string' && origin.startsWith('chrome-extension://');

// HTTP + general gate. No chrome-extension branch: the extension never makes
// HTTP calls, so an extension Origin is not accepted here (nor on /mcp).
export function isOriginAllowed(
  origin: string | string[] | undefined,
  allowed: Set<string> = ALLOWED_ORIGINS,
): boolean {
  if (origin === undefined) return true;        // non-browser caller
  if (typeof origin !== 'string') return false; // duplicated header
  return allowed.has(origin);
}

// WebSocket upgrade gate. The extension is accepted only on the root path (its
// sole connection); /mcp and any other path fall back to isOriginAllowed, which
// accepts no chrome-extension origin.
export function isWebSocketOriginAllowed(
  pathname: string,
  origin: string | string[] | undefined,
  allowed: Set<string> = ALLOWED_ORIGINS,
): boolean {
  if (pathname === '/' && isExtensionOrigin(origin)) return true;
  return isOriginAllowed(origin, allowed);
}

// The /assistants endpoints read and write AI-client config files and are only
// ever called by the welcome page (served from the local server, and the GitHub
// Pages copy that probes localhost then redirects to it). They require one of
// these exact, browser-set origins, so a no-Origin local caller (curl/script)
// can't reach them. Reads allow the Pages origin (its localhost probe); writes
// are localhost-only (configuring happens on the local copy after the redirect).
// Fixed sets - intentionally NOT extended by KAPTURE_ALLOWED_ORIGINS.
const ASSISTANTS_READ_ORIGINS = new Set([
  'http://localhost:61822',
  'http://127.0.0.1:61822',
  'https://williamkapke.github.io',
]);
const ASSISTANTS_WRITE_ORIGINS = new Set([
  'http://localhost:61822',
  'http://127.0.0.1:61822',
]);

export function isAssistantsReadOrigin(origin: string | string[] | undefined): boolean {
  return typeof origin === 'string' && ASSISTANTS_READ_ORIGINS.has(origin);
}

export function isAssistantsWriteOrigin(origin: string | string[] | undefined): boolean {
  return typeof origin === 'string' && ASSISTANTS_WRITE_ORIGINS.has(origin);
}

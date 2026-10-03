import net from 'net';
import path from 'path';

export interface DetachedSpawnContext {
  /** process.versions */
  versions?: { electron?: string };
  /** process.env */
  env?: Record<string, string | undefined>;
  /** process.execPath */
  execPath?: string;
}

/**
 * Whether this runtime may spawn the standalone server as a detached child.
 *
 * Only a plain `node` qualifies. Desktop MCP hosts run the bridge under their
 * own bundled runtime, where the detached child cannot survive anyway, and
 * where the host watches the JS file handed to that child and prompts the user
 * about it on every launch and view change (issues #15 and #24: "Attach
 * 'index.js' to this session?"). Those hosts host the server in-process
 * instead - no child process, no prompt.
 *
 * KAPTURE_DETACHED_SERVER=0/1 overrides the detection either way.
 */
export function canSpawnDetachedServer({
  versions = process.versions as { electron?: string },
  env = process.env,
  execPath = process.execPath,
}: DetachedSpawnContext = {}): boolean {
  const override = env.KAPTURE_DETACHED_SERVER;
  if (override === '0' || override === 'false') return false;
  if (override === '1' || override === 'true') return true;

  // Electron, either as the host runtime itself or as a host that launched us
  // as Node through its own binary.
  if (versions.electron) return false;
  if (env.ELECTRON_RUN_AS_NODE) return false;

  // A bundled runtime that isn't named `node` is a packaged host, not a plain
  // Node install.
  if (!/^node(\.exe)?$/i.test(path.basename(execPath))) return false;

  // A `node` binary shipped inside a desktop host's own install directory
  // (e.g. Claude Desktop's built-in Node) is that host's runtime too.
  if (/[\\/](?:claude|anthropic)[^\\/]*[\\/]/i.test(execPath)) return false;

  return true;
}

/**
 * Resolve true if a TCP connection to host:port succeeds within timeoutMs.
 * Used to detect whether the Kapture server is already listening before the
 * bridge spawns its own, and to poll for the server coming up.
 */
export function probe(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

export interface WaitForPortOptions {
  timeoutMs?: number;
  stepMs?: number;
  probeFn?: (host: string, port: number) => Promise<boolean>;
}

/**
 * Poll host:port until it accepts a connection or the timeout elapses.
 * Returns true as soon as a probe succeeds, false if the budget runs out.
 */
export async function waitForPort(
  host: string,
  port: number,
  options: WaitForPortOptions = {}
): Promise<boolean> {
  const { timeoutMs = 15000, stepMs = 250, probeFn = probe } = options;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeFn(host, port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return false;
}

export type EnsureServerOutcome = 'already-running' | 'spawned' | 'in-process' | 'failed';

export interface EnsureServerOptions {
  host: string;
  port: number;
  /**
   * Best-effort detached spawn of a standalone server process. Omit to skip
   * the detached-child step entirely and host in-process directly (used under
   * hosts where a detached child cannot survive anyway).
   */
  spawnDetached?: () => void;
  /** Host the server inside the current process; resolves once it is listening. */
  startInProcess: () => Promise<void>;
  probeFn?: (host: string, port: number) => Promise<boolean>;
  waitFn?: (host: string, port: number, options?: WaitForPortOptions) => Promise<boolean>;
  /** How long to wait for the detached child to bind before falling back. */
  spawnWaitMs?: number;
  /** How long to wait for the in-process server to bind. */
  inProcessWaitMs?: number;
  /** Diagnostic sink; defaults to a no-op. Never write to stdout (MCP channel). */
  log?: (message: string) => void;
}

/**
 * Make sure a Kapture server is listening on host:port, returning how it got
 * there. The strategy, in order:
 *
 *   1. If a server is already listening, reuse it (multiple MCP clients share
 *      one server so they see the same browser tabs).
 *   2. Otherwise spawn a standalone server as a detached child and wait for it
 *      to bind. This keeps the shared-server model when the host can keep a
 *      detached child alive (e.g. a real `node` from a terminal or Claude Code).
 *      Skipped when no spawnDetached is provided.
 *   3. If that child never binds the port, host the server *inside this
 *      process* instead. This is the fix for issue #13 ("Unable to connect to
 *      extension server"): under hosts whose bundled Node runtime cannot keep a
 *      detached child alive (e.g. Claude Desktop), the spawned server silently
 *      never comes up, and the bridge used to give up with exit(1). Hosting
 *      in-process is guaranteed to work because the bridge itself is already
 *      running in a working Node runtime.
 */
export async function ensureServer(options: EnsureServerOptions): Promise<EnsureServerOutcome> {
  const {
    host,
    port,
    spawnDetached,
    startInProcess,
    probeFn = probe,
    waitFn = waitForPort,
    spawnWaitMs = 8000,
    inProcessWaitMs = 8000,
    log = () => {},
  } = options;

  if (await probeFn(host, port)) {
    return 'already-running';
  }

  if (spawnDetached) {
    // Best-effort: a throw here (e.g. failing to open the spawn log) must not
    // abort the in-process fallback, which is the guaranteed path.
    try {
      spawnDetached();
    } catch (error) {
      log(`detached spawn failed: ${(error as Error)?.message ?? String(error)}`);
    }
    if (await waitFn(host, port, { timeoutMs: spawnWaitMs })) {
      return 'spawned';
    }

    log(
      `detached Kapture server never bound ${host}:${port}; hosting it in-process ` +
        `(this host's runtime cannot keep a detached child alive)`
    );
  }
  try {
    await startInProcess();
  } catch (error) {
    // A late-binding detached child can race the in-process listen to the port
    // (in-process would then fail with EADDRINUSE). If something is now
    // listening, the server is up regardless of who won, so retry succeeds.
    if (await probeFn(host, port)) {
      return 'already-running';
    }
    log(`in-process Kapture server failed to start: ${(error as Error)?.message ?? String(error)}`);
    return 'failed';
  }

  if (await waitFn(host, port, { timeoutMs: inProcessWaitMs })) {
    return 'in-process';
  }
  return 'failed';
}

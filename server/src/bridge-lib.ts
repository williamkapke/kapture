import net from 'net';

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
  /** Best-effort detached spawn of a standalone server process (must not throw). */
  spawnDetached: () => void;
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

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

import { allTools } from './yaml-loader.js';

// Commands eligible inside a compose script: per-tab actions only. Excluded are
// the gated (evaluate), lifecycle/focus (show, close, new_tab), and
// data-returning (screenshot, dom, elements, elementsFromPoint, console_logs,
// watch_console, list_tabs, tab_detail) tools - those are run to read a result,
// not to advance a sequence.
export const ELIGIBLE_COMPOSE_TOOLS = new Set([
  'navigate', 'back', 'forward', 'reload',
  'click', 'hover', 'focus', 'blur',
  'fill', 'type', 'insertText', 'clear', 'select', 'keypress', 'scroll'
]);

const MAX_ACTIONS = 100;
const MAX_WAIT_MS = 60000;

export interface ComposeStep {
  line: number;
  command: string;
  args: any;
  isWait: boolean;
  waitMs: number;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Sleep in slices so a long wait keeps emitting progress (which resets the MCP
// client's request timeout) instead of going silent.
async function chunkedWait(totalMs: number, onTick?: (elapsedMs: number) => void): Promise<void> {
  const SLICE = 5000;
  let elapsed = 0;
  while (elapsed < totalMs) {
    const slice = Math.min(SLICE, totalMs - elapsed);
    await wait(slice);
    elapsed += slice;
    if (onTick) onTick(elapsed);
  }
}

/**
 * Parse a compose script into validated steps. Throws (with all offending lines)
 * if anything is wrong, so a bad script executes nothing.
 *
 * Each non-blank, non-comment line is `<tool>?<query-string>` (split on the
 * first `?`). Query keys are the tool's existing arg names; numeric fields are
 * coerced from their string form per the tool's schema.
 */
export function parseComposeScript(script: string, tabId: string): ComposeStep[] {
  const errors: string[] = [];
  const steps: ComposeStep[] = [];

  script.split(/\r?\n/).forEach((rawLine, idx) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return; // blank lines and comments
    const lineNo = idx + 1;

    const qIdx = line.indexOf('?');
    const command = (qIdx === -1 ? line : line.slice(0, qIdx)).trim();
    const query = qIdx === -1 ? '' : line.slice(qIdx + 1);
    const params = new URLSearchParams(query);

    // wait is a compose-only pseudo-command - not a real tool
    if (command === 'wait') {
      const t = Number(params.get('t'));
      if (!params.has('t') || !Number.isFinite(t) || t < 0 || t > MAX_WAIT_MS) {
        errors.push(`Line ${lineNo}: wait requires t=<milliseconds> in 0-${MAX_WAIT_MS}`);
        return;
      }
      steps.push({ line: lineNo, command: 'wait', args: {}, isWait: true, waitMs: t });
      return;
    }

    if (!ELIGIBLE_COMPOSE_TOOLS.has(command)) {
      errors.push(`Line ${lineNo}: '${command}' is not an eligible compose command`);
      return;
    }

    const tool = allTools.find(t => t.name === command) as any;
    const props = tool.jsonSchema?.properties || {};
    const args: any = {};
    for (const [key, value] of params.entries()) {
      if (key === 'tabId') continue; // injected by compose, never from the line
      if (props[key]?.type === 'number') {
        const n = Number(value);
        args[key] = Number.isFinite(n) ? n : value; // let the schema reject NaN
      } else {
        args[key] = value;
      }
    }

    const check = tool.inputSchema.safeParse({ ...args, tabId });
    if (!check.success) {
      const message = check.error.issues.map((i: any) => i.message).join(', ');
      errors.push(`Line ${lineNo}: ${command}: ${message}`);
      return;
    }

    steps.push({ line: lineNo, command, args, isWait: false, waitMs: 0 });
  });

  if (steps.length === 0 && errors.length === 0) {
    errors.push('Script contains no commands');
  }
  if (steps.length > MAX_ACTIONS) {
    errors.push(`Too many commands: ${steps.length} (max ${MAX_ACTIONS})`);
  }

  if (errors.length) {
    throw new Error('Invalid compose script:\n' + errors.join('\n'));
  }
  return steps;
}

/**
 * Execute a compose script: run each command in order against the shared tab,
 * stopping at the first failure (a tool throwing, or returning success:false -
 * e.g. element-not-found). Returns the in-order array of per-command responses;
 * the last entry holds the failure when stopped early.
 *
 * onProgress fires before each step (and during long waits) so MCP clients that
 * treat progress as keep-alive don't time out on a long batch.
 */
export async function executeCompose(
  args: { script: string; tabId: string },
  callTool: (name: string, args: any, onProgress?: (progress: number, total: number) => void) => Promise<any>,
  onProgress?: (progress: number, total: number) => void
): Promise<any[]> {
  const steps = parseComposeScript(args.script, args.tabId);
  const total = steps.length;
  const results: any[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (onProgress) onProgress(i, total);

    if (step.isWait) {
      await chunkedWait(step.waitMs, (elapsed) => {
        if (onProgress) onProgress(i + elapsed / step.waitMs, total);
      });
      results.push({ command: 'wait', success: true, waited: step.waitMs });
      continue;
    }

    // Map a long sub-command's own progress into this step's slice of the
    // overall bar, so a slow line (e.g. type with a big delay) keeps pinging.
    const stepProgress = onProgress
      ? (subProgress: number, subTotal: number) =>
          onProgress(i + (subTotal ? Math.min(subProgress / subTotal, 1) : 0), total)
      : undefined;

    let parsed: any;
    try {
      const res = await callTool(step.command, { ...step.args, tabId: args.tabId }, stepProgress);
      parsed = JSON.parse(res.content[0].text);
      if (res.isError) parsed.success = false;
    } catch (error: any) {
      parsed = { success: false, error: { message: error.message } };
    }

    results.push({ command: step.command, ...parsed });
    if (parsed.success === false || parsed.error) break; // stop on first failure
  }

  if (onProgress) onProgress(total, total);
  return results;
}

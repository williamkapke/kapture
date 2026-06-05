// Import helper functions from background-commands
import { attachDebugger, respondWith, respondWithError } from './background-commands.js';

// Execute JavaScript in the page's main world via CDP Runtime.evaluate.
// Gated by the per-tab "Allow JavaScript Execution" toggle. The server hides
// the tool when no tab allows it, but this check is the real boundary.
export async function evaluate(tabState, { code, evalTimeout: timeout = 5000 }) {
  const tabId = tabState.tabId;

  if (!tabState.evalAllowed) {
    return respondWithError(tabId, 'EVAL_NOT_ALLOWED', 'JavaScript execution is not enabled for this tab. The user must turn on "Allow JavaScript Execution" in the Kapture extension popup or DevTools panel.');
  }

  return attachDebugger(tabId, async () => {
    const evalPromise = chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
      timeout // terminates runaway scripts (infinite loops)
    });

    // A never-resolving promise won't be terminated by the CDP timeout -
    // race it locally so the debugger session is always released.
    const { result, exceptionDetails } = await Promise.race([
      evalPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Evaluation timed out after ${timeout}ms`)), timeout))
    ]);

    if (exceptionDetails) {
      const message = exceptionDetails.exception?.description
        || exceptionDetails.exception?.value
        || exceptionDetails.text
        || 'JavaScript evaluation failed';
      return respondWithError(tabId, 'EVAL_ERROR', String(message));
    }

    return respondWith(tabId, { value: result.value });
  });
}

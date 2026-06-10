// Text-entry commands that go through the real browser input pipeline (CDP),
// so they work on "fake" inputs that ignore element.value:
//   - type:       send a string as individual keystrokes (keydown/input/keyup per char)
//   - insertText: insert a whole string at once (fires input/beforeinput, no key events)
//   - clear:      select-all + Backspace as real key events
import { getFromContentScript, respondWithError, respondWithInputWarning, attachDebuggerFocused } from './background-commands.js';

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Map a single character to CDP key fields. `text` drives what gets inserted;
// keyCode/code are best-effort for apps that inspect the event.
function keyInfoForChar(ch) {
  if (ch === '\n' || ch === '\r') return { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' };
  if (ch === '\t') return { key: 'Tab', code: 'Tab', keyCode: 9, text: '\t' };

  if (/[a-z]/i.test(ch)) {
    const upper = ch.toUpperCase();
    return { key: ch, code: 'Key' + upper, keyCode: upper.charCodeAt(0), text: ch };
  }
  if (/[0-9]/.test(ch)) {
    return { key: ch, code: 'Digit' + ch, keyCode: ch.charCodeAt(0), text: ch };
  }
  // Any other character (punctuation, symbols, unicode) is inserted via the
  // `text` field with keyCode 0. A real virtual key code here would collide
  // with navigation keys - e.g. '#'.charCodeAt(0) === 35 === End,
  // '$' === 36 === Home - which reorders and drops the typed input.
  return { key: ch, keyCode: 0, text: ch };
}

async function dispatchKey(tabId, type, info, modifiers = 0) {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type,
    modifiers,
    key: info.key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    // Only carry text on keyDown - keyUp never produces characters
    text: type === 'keyDown' ? info.text : undefined
  });
}

// Focus the target element (if one was given) before entering text.
async function focusTarget(tabId, selector, xpath) {
  if (!selector && !xpath) return null;
  const result = await getFromContentScript(tabId, 'focus', { selector, xpath });
  return result.error ? result : null;
}

// type: send a string as individual keystrokes
export async function type({ tabId }, { text, selector, xpath, delay = 0 }) {
  if (typeof text !== 'string') {
    return respondWithError(tabId, 'TEXT_REQUIRED', 'text parameter is required', selector, xpath);
  }
  const keyDelay = Math.max(0, Math.min(5000, delay));

  try {
    const focusError = await focusTarget(tabId, selector, xpath);
    if (focusError) return focusError;

    await attachDebuggerFocused(tabId, async () => {
      // Let focus and the debugger attach settle so the first keystroke isn't
      // dropped by the input pipeline.
      await wait(40);
      for (const ch of text) {
        const info = keyInfoForChar(ch);
        await dispatchKey(tabId, 'keyDown', info);
        await dispatchKey(tabId, 'keyUp', info);
        if (keyDelay) await wait(keyDelay);
      }
    });
    // Respond outside the focused scope - focus emulation makes a hidden page
    // report itself visible, which would suppress the hidden-tab warning.
    return await respondWithInputWarning(tabId, { typed: true, length: text.length }, selector, xpath);
  } catch (error) {
    return respondWithError(tabId, 'TYPE_FAILED', error.message, selector, xpath);
  }
}

// insertText: insert a whole string at once (like an IME commit / paste)
export async function insertText({ tabId }, { text, selector, xpath }) {
  if (typeof text !== 'string') {
    return respondWithError(tabId, 'TEXT_REQUIRED', 'text parameter is required', selector, xpath);
  }

  try {
    const focusError = await focusTarget(tabId, selector, xpath);
    if (focusError) return focusError;

    await attachDebuggerFocused(tabId, async () => {
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
    });
    return await respondWithInputWarning(tabId, { inserted: true, length: text.length }, selector, xpath);
  } catch (error) {
    return respondWithError(tabId, 'INSERT_TEXT_FAILED', error.message, selector, xpath);
  }
}

// clear: select all content (via the DOM) then delete it with a real Backspace
// key event. Works on inputs, textareas, contenteditable, and "fake" inputs.
export async function clear({ tabId }, { selector, xpath }) {
  try {
    // DOM select-all is reliable; a synthetic Ctrl/Cmd+A is not honored as an
    // edit command by the browser.
    const selected = await getFromContentScript(tabId, '_selectAll', { selector, xpath });
    if (selected.error) return selected;

    await attachDebuggerFocused(tabId, async () => {
      await wait(20);
      const backspace = { key: 'Backspace', code: 'Backspace', keyCode: 8 };
      await dispatchKey(tabId, 'keyDown', backspace);
      await dispatchKey(tabId, 'keyUp', backspace);
    });
    return await respondWithInputWarning(tabId, { cleared: true }, selector, xpath);
  } catch (error) {
    return respondWithError(tabId, 'CLEAR_FAILED', error.message, selector, xpath);
  }
}

// Import helper functions from background-commands
import { getFromContentScript, respondWithError, respondWithInputWarning, attachDebuggerFocused } from './background-commands.js';

// Additional helper functions
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Send keypress event
export async function keypress({tabId}, params) {
  const { key, selector, xpath, delay = 50 } = params;

  if (!key) {
    return respondWithError(tabId, 'KEY_REQUIRED', 'Key parameter is required');
  }

  // Validate delay is within reasonable bounds (0-60000ms = 0-60 seconds)
  const keypressDelay = Math.max(0, Math.min(60000, delay));

  try {
    // First, focus the target element if selector/xpath provided
    if (selector || xpath) {
      const focusResult = await getFromContentScript(tabId, 'focus', { selector, xpath });
      if (focusResult.error) {
        return focusResult;
      }
    }

    // Parse key combination to extract key and modifiers
    const keyData = parseKeyCombination(key);

    // Use attachDebuggerFocused so key events reach hidden tabs too
    const resultData = await attachDebuggerFocused(tabId, async () => {
      // Helper function to send key event
      const sendKeyEvent = async (type, autoRepeat = false, text = null) => {
        const eventData = {
          type,
          ...keyData,
          windowsVirtualKeyCode: keyData.keyCode,
          nativeVirtualKeyCode: keyData.keyCode
        };

        if (type === 'keyDown' || type === 'keyUp') {
          eventData.autoRepeat = autoRepeat;
        }

        if (text) {
          eventData.text = text;
        }

        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', eventData);
      };

      // Send keydown event
      await sendKeyEvent('keyDown', false);

      // If delay > 500ms, simulate key repeat
      if (keypressDelay > 500) {
        // Calculate number of repeat events based on delay
        // Typical repeat rate is ~30ms between events
        const repeatInterval = 30;
        const repeatCount = Math.floor((keypressDelay - 100) / repeatInterval);

        // Wait a bit before starting repeat (typical OS behavior)
        await wait(50);

        // Send repeated keydown events
        for (let i = 0; i < repeatCount; i++) {
          await sendKeyEvent('keyDown', true);

          // Wait between repeat events
          if (i < repeatCount - 1) {
            await wait(repeatInterval);
          }
        }
      } else if (keypressDelay > 0) {
        // For delays <= 500ms, just wait the specified time
        await wait(keypressDelay);
      }

      // Send keyup event
      await sendKeyEvent('keyUp');

      // Wait a bit for the page to process the key events
      await wait(50);

      // Keys that typically cause scrolling need extra time to settle
      const scrollKeys = ['PageUp', 'PageDown', 'Space', ' ', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (!selector && !xpath && scrollKeys.includes(keyData.key)) {
        // Additional delay for scroll to complete when key is pressed globally (not on a specific element)
        await wait(100);
      }

      // Get result including element info if selector was provided
      const data = {
        keyPressed: true,
        key: key,
        delay: keypressDelay
      };

      // If this was an auto-repeat key press, include that info
      if (keypressDelay > 500) {
        data.autoRepeat = true;
        data.repeatCount = Math.floor((keypressDelay - 100) / 30);
      }

      return data;
    });

    // Respond outside the focused scope - focus emulation makes a hidden page
    // report itself visible, which would suppress the hidden-tab warning.
    return await respondWithInputWarning(tabId, resultData, selector, xpath);
  } catch (error) {
    return respondWithError(tabId, 'KEYPRESS_FAILED', error.message, selector, xpath);
  }
}

// Parse key combination and return CDP-compatible key data
function parseKeyCombination(keyCombination) {
  let modifiers = 0;
  let key = '';

  // CDP modifier flags
  const CDP_MODIFIERS = {
    alt: 1,
    ctrl: 2,
    meta: 4,
    shift: 8
  };

  // Special key mappings
  const KEY_MAPPINGS = {
    'enter': { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    'return': { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    'tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
    'delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
    'backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
    'escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
    'esc': { key: 'Escape', code: 'Escape', keyCode: 27 },
    'space': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    ' ': { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
    'arrowup': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
    'arrowdown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
    'arrowleft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
    'arrowright': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
    'pageup': { key: 'PageUp', code: 'PageUp', keyCode: 33 },
    'pagedown': { key: 'PageDown', code: 'PageDown', keyCode: 34 },
    'home': { key: 'Home', code: 'Home', keyCode: 36 },
    'end': { key: 'End', code: 'End', keyCode: 35 },
    'insert': { key: 'Insert', code: 'Insert', keyCode: 45 },
    'f1': { key: 'F1', code: 'F1', keyCode: 112 },
    'f2': { key: 'F2', code: 'F2', keyCode: 113 },
    'f3': { key: 'F3', code: 'F3', keyCode: 114 },
    'f4': { key: 'F4', code: 'F4', keyCode: 115 },
    'f5': { key: 'F5', code: 'F5', keyCode: 116 },
    'f6': { key: 'F6', code: 'F6', keyCode: 117 },
    'f7': { key: 'F7', code: 'F7', keyCode: 118 },
    'f8': { key: 'F8', code: 'F8', keyCode: 119 },
    'f9': { key: 'F9', code: 'F9', keyCode: 120 },
    'f10': { key: 'F10', code: 'F10', keyCode: 121 },
    'f11': { key: 'F11', code: 'F11', keyCode: 122 },
    'f12': { key: 'F12', code: 'F12', keyCode: 123 }
  };

  // Parse modifiers from combination
  let remaining = keyCombination;
  const modifierPatterns = [
    { pattern: /^(Control|Ctrl)\+/i, modifier: 'ctrl' },
    { pattern: /^Shift\+/i, modifier: 'shift' },
    { pattern: /^Alt|Option\+/i, modifier: 'alt' },
    { pattern: /^(Meta|Cmd|Command)\+/i, modifier: 'meta' }
  ];

  // Extract modifiers
  let foundModifier = true;
  while (foundModifier && remaining) {
    foundModifier = false;
    for (const { pattern, modifier } of modifierPatterns) {
      if (pattern.test(remaining)) {
        modifiers |= CDP_MODIFIERS[modifier];
        remaining = remaining.replace(pattern, '');
        foundModifier = true;
        break;
      }
    }
  }

  // What's left is the key
  key = remaining;

  // Look up special key mapping
  const lowerKey = key.toLowerCase();
  if (KEY_MAPPINGS[lowerKey]) {
    return {
      ...KEY_MAPPINGS[lowerKey],
      modifiers,
      text: KEY_MAPPINGS[lowerKey].text || undefined
    };
  }

  // For single character keys
  if (key.length === 1) {
    const keyCode = key.toUpperCase().charCodeAt(0);
    return {
      key: key,
      code: 'Key' + key.toUpperCase(),
      keyCode: keyCode,
      modifiers,
      text: modifiers === 0 ? key : undefined // Only send text for unmodified keys
    };
  }

  // For other keys, try to generate a reasonable code
  return {
    key: key,
    code: key,
    keyCode: 0, // Unknown keycode
    modifiers
  };
}

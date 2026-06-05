// Import helper functions from background-commands
import { getFromContentScript, respondWith, respondWithError, attachDebugger, getElement } from './background-commands.js';

export async function click({tabId, mousePosition}, { selector, xpath }) {
  return await hover({ tabId, mousePosition }, { selector, xpath }, true);
}

export async function hover(tab, { selector, xpath }, click = false) {
  const { tabId, mousePosition } = tab;
  // Validate that either selector or xpath is provided
  if (!selector && !xpath) {
    return respondWithError(tabId, 'SELECTOR_OR_XPATH_REQUIRED', 'Either selector or xpath is required');
  }

  // Get element and validate it exists and is visible
  const elementResult = await getElement(tabId, selector, xpath, true);
  if (elementResult.error) return elementResult;

  // Get current mouse position
  const currentPosition = mousePosition || { x: 0, y: 0 };

  // Calculate target position (center of element)
  const targetX = elementResult.element.bounds.x + elementResult.element.bounds.width / 2;
  const targetY = elementResult.element.bounds.y + elementResult.element.bounds.height / 2;

  try {
    // Show cursor
    await getFromContentScript(tabId, '_cursor', { show: true });

    // Set initial cursor position
    await getFromContentScript(tabId, '_moveMouseSVG', { x: currentPosition.x, y: currentPosition.y });

    // Animation configuration
    const pixelsPerSecond = 1000; // Adjust for desired speed
    const frameInterval = 16; // ~60fps

    await attachDebugger(tabId, async () => {
      const sendCmd = (cmd, params) => chrome.debugger.sendCommand({ tabId }, cmd, params);
      const dispatchMouseEvent = (params) => sendCmd('Input.dispatchMouseEvent', params);

      // Enable Input domain for mouse events
      // await sendCmd('Input.enable');

      // Function to animate to a position
      const animateToPosition = async (fromX, fromY, toX, toY) => {
        const distance = Math.sqrt(Math.pow(toX - fromX, 2) + Math.pow(toY - fromY, 2));
        const duration = Math.min(1000, (distance / pixelsPerSecond) * 1000);
        const animSteps = Math.max(1, Math.ceil(duration / frameInterval));
        const dx = (toX - fromX) / animSteps;
        const dy = (toY - fromY) / animSteps;

        for (let i = 1; i <= animSteps; i++) {
          const x = fromX + (dx * i);
          const y = fromY + (dy * i);

          // Move visual cursor
          await getFromContentScript(tabId, '_moveMouseSVG', { x, y });

          // Send mouse move event
          await dispatchMouseEvent({ type: 'mouseMoved', x, y });

          // Wait for next frame
          await new Promise(resolve => setTimeout(resolve, frameInterval));
        }

        return { x: toX, y: toY };
      };

      // Initial animation to target
      let finalPosition = await animateToPosition(currentPosition.x, currentPosition.y, targetX, targetY);

      // Try up to 5 times to ensure we're over the target element
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const finalCheck = await getElement(tabId, selector, xpath, true);
        if (!finalCheck.error && finalCheck.element) {
          const bounds = finalCheck.element.bounds;

          // Check if cursor is actually over the element
          const isOverElement = finalPosition.x >= bounds.x &&
                               finalPosition.x <= bounds.x + bounds.width &&
                               finalPosition.y >= bounds.y &&
                               finalPosition.y <= bounds.y + bounds.height;

          if (!isOverElement) {
            // Calculate new target center and animate to it
            const actualTargetX = bounds.x + bounds.width / 2;
            const actualTargetY = bounds.y + bounds.height / 2;
            finalPosition = await animateToPosition(finalPosition.x, finalPosition.y, actualTargetX, actualTargetY);
          } else {
            // Cursor is over the element, we're done
            break;
          }
        } else {
          // Element not found, stop trying
          break;
        }
      }

      const bounds = await getFromContentScript(tabId, '_elementPosition', { id: elementResult.element.id });
      if (!bounds) {
        // Element was removed from the DOM mid-command (e.g. the page re-rendered)
        throw new Error(`Element disappeared before the ${click ? 'click' : 'hover'} completed`);
      }
      const actualTargetX = bounds.x + bounds.width / 2;
      const actualTargetY = bounds.y + bounds.height / 2;
      await getFromContentScript(tabId, '_moveMouseSVG', { x: actualTargetX, y: actualTargetY });

      if (click) {
        await dispatchMouseEvent({type: 'mousePressed', x: actualTargetX, y: actualTargetY, button: 'left', clickCount: 1});
        await dispatchMouseEvent({type: 'mouseReleased', x: actualTargetX, y: actualTargetY, button: 'left', clickCount: 1});
      }
    });

    // Hide cursor after 1 second
    setTimeout(async () => {
      await getFromContentScript(tabId, '_cursor', { show: false });
    }, 1000);

    return respondWith(tabId, click ? { clicked: true } : { hovered: true }, selector, xpath);
  } catch (error) {
    // Make sure cursor is hidden on error
    await getFromContentScript(tabId, '_cursor', { show: false });
    return respondWithError(tabId, 'CLICK_FAILED', error.message, selector, xpath);
  }
}

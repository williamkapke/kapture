// Import helper functions from background-commands
import { getElement, getTabInfo, respondWithError, attachDebugger } from './background-commands.js';

export async function screenshot({tabId}, { scale = 0.5, quality = 0.5, format = 'webp', selector, xpath }) {
  let elementResult;
  if (selector || xpath) {
    elementResult = await getElement(tabId, selector, xpath, true);
    if (elementResult.error) return elementResult;
  }
  else {
    elementResult = await getTabInfo(tabId)
    elementResult.element = {
      bounds: {
        x: elementResult.scrollPosition.x,
        y: elementResult.scrollPosition.y,
        width: elementResult.viewportDimensions.width,
        height: elementResult.viewportDimensions.height
      }
    };
  }

  const clip = { ...elementResult.element.bounds };
  
  // For fixed positioned elements, we need viewport-relative coordinates
  // For non-fixed elements, we need document-relative coordinates
  if (elementResult.element.position !== 'fixed') {
    // Add scroll position to convert from viewport to document coordinates
    clip.x += elementResult.scrollPosition.x;
    clip.y += elementResult.scrollPosition.y;
  }
  
  if (scale) {
    clip.scale = scale;
  }

  return attachDebugger(tabId, async () => {
    const screenshot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', {
      format,
      quality: Math.round(quality * 100), // Chrome needs an integer percentage,
      clip
    });

    return {
      success: true,
      ...elementResult,
      element: undefined,
      selector: elementResult.element?.selector || undefined,
      mimeType: `image/${format}`,
      data: screenshot.data,
    };
  })
  .catch((err) => {
    return respondWithError(tabId,'SCREENSHOT_ERROR', err.message, null, null);
  });
}
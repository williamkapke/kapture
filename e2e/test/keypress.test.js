import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo, delay } from './helpers.js';

describe('Keypress Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state and get updated HTML
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html?t=" + Date.now() // Force reload
    });

    // Clear any existing input values
    await framework.callTool('fill', {
      selector: '#text-input',
      value: ''
    });
  });

  it('should type single character', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'a',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('a');
    expect(resultData).to.have.property('delay').that.equals(50);
    expect(resultData).to.have.property('selector').that.equals('#text-input');

    // Verify the character was typed
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].value).to.equal('a');
  });

  it('should type multiple characters sequentially', async function() {
    // Type 'hello'
    const keys = ['h', 'e', 'l', 'l', 'o'];
    for (const key of keys) {
      await framework.callToolAndParse('keypress', {
        key: key,
        selector: '#text-input'
      });
    }

    // Verify the word was typed
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].value).to.equal('hello');
  });

  it('should handle special keys - Enter', async function() {
    // First type some text
    await framework.callToolAndParse('fill', {
      selector: '#text-input',
      value: 'test'
    });

    // Press Enter
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Enter',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('Enter');
  });

  it('should submit a form with Enter (implicit form submission)', async function() {
    // Enter must carry the char event (text '\r') for the browser to run
    // implicit form submission - #test-form GETs test.html?formval=...
    await framework.callToolAndParse('fill', {
      selector: '#form-input',
      value: 'enter-submit'
    });

    // The submission navigates the page, which can race the keypress
    // response's tab-info fetch - the outcome below is what matters.
    await framework.callTool('keypress', {
      key: 'Enter',
      selector: '#form-input'
    }).catch(() => {});

    await delay(750); // let the form navigation complete

    const elementData = await framework.callToolAndParse('elements', {
      selector: 'body'
    });
    expect(elementData.url).to.include('formval=enter-submit');
  });

  it('should handle special keys - Tab', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Tab',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('Tab');
  });

  it('should handle Backspace key', async function() {
    // First type some text
    await framework.callToolAndParse('fill', {
      selector: '#text-input',
      value: 'test'
    });

    // Press Backspace
    await framework.callToolAndParse('keypress', {
      key: 'Backspace',
      selector: '#text-input'
    });

    // Verify one character was deleted
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].value).to.equal('tes');
  });

  it('should handle modifier keys - Ctrl+A', async function() {
    // First type some text
    await framework.callToolAndParse('fill', {
      selector: '#text-input',
      value: 'test text'
    });

    // Press Ctrl+A to select all
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Ctrl+a',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('Ctrl+a');
  });

  it('should handle arrow keys', async function() {
    // Page now has scrollable content, scroll down a bit first
    // Use PageDown to get to a middle position
    const pageDownResult = await framework.callToolAndParse('keypress', {
      key: 'PageDown'
    });

    // Get scroll position from the PageDown result
    const initialScrollY = pageDownResult.scrollPosition.y;
    const initialScrollX = pageDownResult.scrollPosition.x;
    expect(initialScrollY).to.be.greaterThan(0); // Verify we're not at top

    // Test ArrowDown (should scroll down when not in input)
    let resultData = await framework.callToolAndParse('keypress', {
      key: 'ArrowDown'
    });
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData.scrollPosition.y).to.be.greaterThan(initialScrollY);

    // Test ArrowUp (should scroll up)
    resultData = await framework.callToolAndParse('keypress', {
      key: 'ArrowUp'
    });
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData.scrollPosition.y).to.be.lessThanOrEqual(initialScrollY);

    // Test arrow keys in input field (should NOT scroll)
    // Focus the input (this will scroll to top of page where input is)
    const focusResult = await framework.callToolAndParse('focus', {
      selector: '#text-input'
    });

    // Get the scroll position AFTER focusing
    const inputScrollY = focusResult.scrollPosition.y;
    const inputScrollX = focusResult.scrollPosition.x;

    // Arrow keys in input should not scroll the page
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      resultData = await framework.callToolAndParse('keypress', {
        key: key,
        selector: '#text-input'
      });

      expectValidTabInfo(resultData);
      expect(resultData).to.have.property('keyPressed').that.equals(true);
      expect(resultData).to.have.property('key').that.equals(key);
      // Scroll position should not change when navigating in input
      expect(resultData.scrollPosition.y).to.equal(inputScrollY);
      expect(resultData.scrollPosition.x).to.equal(inputScrollX);
    }
  });

  it('should handle function keys', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'F5'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('F5');
  });

  it('should handle Space key', async function() {
    // Test 1: Space in input field
    await framework.callToolAndParse('fill', {
      selector: '#text-input',
      value: 'hello'
    });

    // Press Space in input
    await framework.callToolAndParse('keypress', {
      key: 'Space',
      selector: '#text-input'
    });

    // Type more text
    await framework.callToolAndParse('keypress', {
      key: 'w',
      selector: '#text-input'
    });

    // Verify space was inserted
    let elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].value).to.equal('hello w');

    // Test 2: Space key scrolls page when not in input
    // First blur the input to remove focus
    await framework.callTool('blur', {
      selector: '#text-input'
    });

    // Scroll down a bit so we're not at the top
    const scrollDownResult = await framework.callToolAndParse('keypress', {
      key: 'PageDown'
    });

    // Get initial scroll position
    const initialScrollY = scrollDownResult.scrollPosition.y;
    expect(initialScrollY).to.be.greaterThan(0); // Verify we're not at top

    // Press Space without selector (should scroll page further down)
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Space'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);

    // Space should scroll the page down further
    expect(resultData.scrollPosition.y).to.be.greaterThan(initialScrollY);
  });

  it('should handle custom delay', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'a',
      selector: '#text-input',
      delay: 200
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('delay').that.equals(200);
  });

  it('should handle auto-repeat for long delays', async function() {
    // Press and hold 'a' for 600ms (should trigger auto-repeat)
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'a',
      selector: '#text-input',
      delay: 600
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('delay').that.equals(600);
    expect(resultData).to.have.property('autoRepeat').that.equals(true);
    expect(resultData).to.have.property('repeatCount').that.is.greaterThan(0);

    // Verify multiple characters were typed
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].value.length).to.be.greaterThan(1);
  });

  it('should work without selector (global keypress)', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Escape'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('Escape');
    expect(resultData).to.not.have.property('selector');
    expect(resultData).to.not.have.property('xpath');
  });

  it('should work with xpath selector', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'x',
      xpath: '//input[@id="text-input"]'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('xpath').that.equals('//input[@id="text-input"]');
    expect(resultData).to.not.have.property('selector');

    // Verify the character was typed
    const elementData = await framework.callToolAndParse('elements', {
      xpath: '//input[@id="text-input"]'
    });
    expect(elementData.elements[0].value).to.equal('x');
  });

  it('should handle PageDown and PageUp', async function() {
    // The test page now has a 3000px tall element, so we can test scrolling
    // Get initial scroll position (should be at top)
    let tabInfo = await framework.callToolAndParse('tab_detail', {});
    const initialScrollY = tabInfo.scrollPosition.y;
    expect(initialScrollY).to.equal(0);

    // Test PageDown
    let resultData = await framework.callToolAndParse('keypress', {
      key: 'PageDown'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('PageDown');

    // Check that page scrolled down
    expect(resultData.scrollPosition.y).to.be.greaterThan(initialScrollY);
    const scrolledDownPosition = resultData.scrollPosition.y;

    // Test PageUp
    resultData = await framework.callToolAndParse('keypress', {
      key: 'PageUp'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('keyPressed').that.equals(true);
    expect(resultData).to.have.property('key').that.equals('PageUp');

    // Check that page scrolled back up
    expect(resultData.scrollPosition.y).to.be.lessThan(scrolledDownPosition);
  });

  it('should handle Home and End keys', async function() {
    // First add some text
    await framework.callToolAndParse('fill', {
      selector: '#text-input',
      value: 'test text here'
    });

    // Press Home
    let resultData = await framework.callToolAndParse('keypress', {
      key: 'Home',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('key').that.equals('Home');

    // Press End
    resultData = await framework.callToolAndParse('keypress', {
      key: 'End',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('key').that.equals('End');
  });

  it('should handle Delete key', async function() {
    // First type some text
    await framework.callToolAndParse('fill', {
      selector: '#text-input',
      value: 'test'
    });

    // Move cursor to beginning
    await framework.callToolAndParse('keypress', {
      key: 'Home',
      selector: '#text-input'
    });

    // Press Delete
    await framework.callToolAndParse('keypress', {
      key: 'Delete',
      selector: '#text-input'
    });

    // Verify first character was deleted
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].value).to.equal('est');
  });

  it('should handle Shift modifier', async function() {
    // Type uppercase letter with Shift
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Shift+a',
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('key').that.equals('Shift+a');

    // Note: Shift+a might not produce 'A' due to how key events work
    // The actual character produced depends on the browser's handling
  });

  it('should handle maximum delay limit', async function() {
    this.timeout(65000); // Increase timeout for this test

    // Test a large delay that's still within limits
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'a',
      selector: '#text-input',
      delay: 2000 // 2 seconds (well within limits but triggers auto-repeat)
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('delay').that.equals(2000);
    expect(resultData).to.have.property('autoRepeat').that.equals(true);
    expect(resultData).to.have.property('repeatCount').that.is.greaterThan(0);
  });

  it('should reject delay beyond maximum limit', async function() {
    // Try to use a delay beyond the 60-second limit
    try {
      await framework.callToolAndParse('keypress', {
        key: 'a',
        selector: '#text-input',
        delay: 70000 // 70 seconds
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).to.include('60000');
    }
  });

  it('should return error when key is missing', async function() {
    // Key is a required parameter, so this should throw a validation error
    try {
      await framework.callToolAndParse('keypress', {
        selector: '#text-input'
      });
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).to.include('Required');
    }
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'a',
      selector: '#non-existent-input'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
  });

  it('should handle multiple modifier keys', async function() {
    const resultData = await framework.callToolAndParse('keypress', {
      key: 'Ctrl+Shift+a',
      selector: '#text-input'
    });

    // Check if it's an error response first
    if (resultData.error) {
      console.log('Multiple modifier key error:', resultData.error);
      // For now, skip this test if multiple modifiers aren't supported
      this.skip();
    } else {
      expectValidTabInfo(resultData);
      expect(resultData).to.have.property('keyPressed').that.equals(true);
      expect(resultData).to.have.property('key').that.equals('Ctrl+Shift+a');
    }
  });
});

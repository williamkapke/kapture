import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Blur Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page for clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html?t=" + Date.now()
    });
  });

  it('should blur a focused input element', async function() {
    // First focus the input
    await framework.callTool('focus', {
      selector: '#text-input'
    });

    // Verify it's focused
    let elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].focused).to.be.true;

    // Now blur it
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);
    expect(resultData).to.have.property('selector').that.equals('#text-input');

    // Verify it's no longer focused
    elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].focused).to.be.false;
  });

  it('should blur using xpath selector', async function() {
    // Focus the select element
    await framework.callTool('focus', {
      selector: '#select-input'
    });

    // Blur using xpath
    const resultData = await framework.callToolAndParse('blur', {
      xpath: '//select[@id="select-input"]'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);
    expect(resultData).to.have.property('xpath').that.equals('//select[@id="select-input"]');
    expect(resultData).to.not.have.property('selector');

    // Verify it's no longer focused
    const elementData = await framework.callToolAndParse('elements', {
      xpath: '//select[@id="select-input"]'
    });
    expect(elementData).to.have.property('elements');
    expect(elementData.elements).to.have.lengthOf.at.least(1);
    expect(elementData.elements[0].focused).to.be.false;
  });

  it('should handle blurring an already unfocused element', async function() {
    // Ensure nothing is focused by clicking on body
    await framework.callTool('click', {
      selector: 'body'
    });

    // Try to blur an unfocused element
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);
    // Should succeed even if element wasn't focused
  });

  it('should blur textarea elements', async function() {
    // Focus the textarea
    await framework.callTool('focus', {
      selector: '#textarea-input'
    });

    // Blur it
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#textarea-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);

    // Verify it's no longer focused
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#textarea-input'
    });
    expect(elementData.elements[0].focused).to.be.false;
  });

  it('should blur button elements', async function() {
    // Focus a button
    await framework.callTool('focus', {
      selector: '#test-button'
    });

    // Blur it
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#test-button'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#non-existent-element'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
    expect(resultData.error.message).to.include('not found');
  });

  it('should handle invalid selector', async function() {
    const resultData = await framework.callToolAndParse('blur', {
      selector: '##invalid-selector'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('INVALID_SELECTOR');
  });

  it('should handle invalid xpath', async function() {
    const resultData = await framework.callToolAndParse('blur', {
      xpath: '//invalid[xpath'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('INVALID_XPATH');
  });

  it('should require either selector or xpath', async function() {
    let error;
    try {
      await framework.callToolAndParse('blur', {});
    } catch (e) {
      error = e;
    }

    // Rejected by the server's input validation (-32602 Invalid params)
    expect(error, 'expected a validation error').to.exist;
    expect(error.code).to.equal(-32602);
    expect(error.message).to.include('Provide exactly one of selector or xpath');
  });

  it('should reject both selector and xpath', async function() {
    let error;
    try {
      await framework.callToolAndParse('blur', {
        selector: '#text-input',
        xpath: '//input'
      });
    } catch (e) {
      error = e;
    }

    // Exactly one of selector/xpath is allowed (-32602 Invalid params)
    expect(error, 'expected a validation error').to.exist;
    expect(error.code).to.equal(-32602);
    expect(error.message).to.include('Provide exactly one of selector or xpath');
  });

  it('should blur document.activeElement if different from target', async function() {
    // Focus input1
    await framework.callTool('focus', {
      selector: '#text-input'
    });

    // Focus select (making it the activeElement)
    await framework.callTool('focus', {
      selector: '#select-input'
    });

    // Blur the first input (not currently active)
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);

    // Both elements should be unfocused now
    let elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].focused).to.be.false;

    elementData = await framework.callToolAndParse('elements', {
      selector: '#select-input'
    });
    expect(elementData.elements[0].focused).to.be.false;
  });

  it('should work with contenteditable elements', async function() {
    // First, let's check if we have a contenteditable element in the test page
    const elementsData = await framework.callToolAndParse('elements', {
      selector: '[contenteditable="true"]'
    });

    if (elementsData.error || elementsData.elements.length === 0) {
      // Skip if no contenteditable element exists
      this.skip();
    }

    // Focus the contenteditable element
    await framework.callTool('focus', {
      selector: '[contenteditable="true"]'
    });

    // Blur it
    const resultData = await framework.callToolAndParse('blur', {
      selector: '[contenteditable="true"]'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);
  });

  it('should remove focus from page when blurring the only focused element', async function() {
    // Focus an element
    await framework.callTool('focus', {
      selector: '#text-input'
    });

    // Blur it
    await framework.callTool('blur', {
      selector: '#text-input'
    });

    // Verify the element is no longer focused
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elementData.elements[0].focused).to.be.false;
  });

  it('should handle blurring elements in iframes', async function() {
    // First check if the test page has an iframe
    const iframeCheck = await framework.callToolAndParse('elements', {
      selector: 'iframe'
    });

    if (iframeCheck.error || iframeCheck.elements.length === 0) {
      this.skip(); // Skip if no iframe in test page
    }

    // This would require iframe support in the blur tool
    // For now, we'll just verify it handles the case gracefully
    const resultData = await framework.callToolAndParse('blur', {
      selector: 'iframe'
    });

    // Should either succeed or give a meaningful error
    if (resultData.error) {
      expect(resultData.error.code).to.be.oneOf(['ELEMENT_NOT_FOUND', 'IFRAME_NOT_SUPPORTED']);
    } else {
      expect(resultData).to.have.property('blurred');
    }
  });

  it('should work after navigation', async function() {
    // Navigate to a different URL
    await framework.callTool('navigate', {
      url: 'http://localhost:61822/test.html?page=blur-test'
    });

    // Focus an element
    await framework.callTool('focus', {
      selector: '#text-input'
    });

    // Blur should work on the new page
    const resultData = await framework.callToolAndParse('blur', {
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);
  });

  it('should blur only the first matching element when multiple match', async function() {
    // The test page has multiple inputs we can use
    // Focus the select element
    await framework.callTool('focus', {
      selector: '#select-input'
    });

    // Blur using a generic selector that matches multiple elements
    // This should blur the first input element found
    const resultData = await framework.callToolAndParse('blur', {
      selector: 'input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('blurred').that.equals(true);

    // Since blur also removes focus from activeElement,
    // the select should also be unfocused now
    const selectData = await framework.callToolAndParse('elements', {
      selector: '#select-input'
    });
    expect(selectData.elements[0].focused).to.be.false;
  });
});

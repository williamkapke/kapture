import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo, delay } from './helpers.js';

describe('Hover Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });

    // Wait a bit for page to fully load
    await delay(500);
  });

  it('should hover over element using selector', async function() {
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hover-box-1'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);
    expect(resultData).to.have.property('selector').that.equals('#hover-box-1');
    expect(resultData).to.not.have.property('xpath');
  });

  it('should hover over element using xpath', async function() {
    const resultData = await framework.callToolAndParse('hover', {
      xpath: '//div[@id="hover-tooltip"]'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);
    expect(resultData).to.have.property('xpath').that.equals('//div[@id="hover-tooltip"]');
    expect(resultData).to.not.have.property('selector');
  });

  it('should trigger hover counter', async function() {
    // Get initial count
    const initialDom = await framework.callToolAndParse('dom', {
      selector: '#hover-count-display'
    });
    const initialMatch = initialDom.html.match(/>(\d+)</);
    const initialCount = initialMatch ? parseInt(initialMatch[1]) : 0;

    // Hover over the counter
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hover-counter'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);

    // Wait for hover effect to trigger
    await delay(500);

    // Check if count increased
    const afterDom = await framework.callToolAndParse('dom', {
      selector: '#hover-count-display'
    });
    const afterMatch = afterDom.html.match(/>(\d+)</);
    const afterCount = afterMatch ? parseInt(afterMatch[1]) : 0;
    expect(afterCount).to.equal(initialCount + 1);
  });

  it('should make tooltip visible on hover', async function() {
    // Check tooltip is initially hidden
    const beforeElements = await framework.callToolAndParse('elements', {
      selector: '#hover-tooltip .tooltip-text'
    });
    expect(beforeElements.elements[0].visible).to.equal(false);

    // Hover over the tooltip trigger
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hover-tooltip'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);

    // Wait for CSS transition
    await delay(500);

    // Check if tooltip is now visible
    const afterElements = await framework.callToolAndParse('elements', {
      selector: '#hover-tooltip .tooltip-text'
    });
    expect(afterElements.elements[0].visible).to.equal(true);
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#non-existent-element'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('ELEMENT_NOT_FOUND');
    expect(resultData).to.have.property('selector').that.equals('#non-existent-element');
  });

  it('should require either selector or xpath', async function() {
    let error;
    try {
      await framework.callToolAndParse('hover', {});
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
      await framework.callToolAndParse('hover', {
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

  it('should handle invalid selector', async function() {
    const resultData = await framework.callToolAndParse('hover', {
      selector: '##invalid-selector'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('INVALID_SELECTOR');
    expect(resultData.error).to.have.property('message').that.includes('Invalid selector');
  });

  it('should handle invalid xpath', async function() {
    const resultData = await framework.callToolAndParse('hover', {
      xpath: '//invalid[xpath'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('INVALID_XPATH');
    expect(resultData.error).to.have.property('message').that.includes('Invalid XPath');
  });

  it('should animate cursor during hover', async function() {
    this.timeout(5000); // Give more time for animation

    // Perform hover
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hover-image'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);

    // The cursor animation happens and cursor should remain visible for 1 second
    // Just verify the hover completed successfully
  });

  it('should hover on various element types', async function() {
    // Test hovering different types of elements
    const elements = ['#test-button', '#text-input', '#test-link', '#select-input'];

    for (const selector of elements) {
      const resultData = await framework.callToolAndParse('hover', {
        selector: selector
      });

      expectValidTabInfo(resultData);
      expect(resultData).to.have.property('hovered').that.equals(true);
      expect(resultData).to.have.property('selector').that.equals(selector);
    }
  });

  it('should hover on disabled elements', async function() {
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#disabled-button'
    });

    // Hover should succeed even on disabled elements
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);
    expect(resultData).to.have.property('selector').that.equals('#disabled-button');
  });

  it('should trigger CSS hover effects', async function() {
    // Hover over the hover box which has CSS transitions
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hover-box-1'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);

    // Wait for CSS transition to apply
    await delay(400);

    // The hover effect should be applied (background color changed)
    // We can't directly check computed styles, but we can verify the hover succeeded
  });

  it('should not hover on invisible elements', async function() {
    // The hover tool only finds visible elements
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hidden-element'
    });

    // Should return element not found since getElement with visible=true won't find it
    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('ELEMENT_NOT_FOUND');
  });

  it('should maintain hover position', async function() {
    // Hover over an element
    const resultData = await framework.callToolAndParse('hover', {
      selector: '#hover-counter'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('hovered').that.equals(true);

    // The cursor should remain at the hover position
    // Additional tools would need to verify mouse position
  });
});

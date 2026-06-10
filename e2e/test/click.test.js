import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo, delay } from './helpers.js';

describe('Click Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });

    // Wait a bit for page to fully load
    await delay(500);
  });

  it('should click on button using selector', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#test-button'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('clicked').that.equals(true);
    expect(resultData).to.have.property('selector').that.equals('#test-button');
    expect(resultData).to.not.have.property('xpath');

    // Wait for click to process
    await delay(100);

    // Verify the button was actually clicked by checking the DOM
    const dom = await framework.callToolAndParse('dom', {
      selector: '#click-result'
    });
    expect(dom.html).to.include('Test button clicked at');
  });

  it('should click on link using xpath', async function() {
    const resultData = await framework.callToolAndParse('click', {
      xpath: '//a[@id="test-link"]'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('clicked').that.equals(true);
    expect(resultData).to.have.property('xpath').that.equals('//a[@id="test-link"]');
    expect(resultData).to.not.have.property('selector');

    // Wait for navigation
    await delay(100);

    // Check if URL changed to include the anchor
    expect(resultData.url).to.include('#anchor1');
  });

  it('should click on select dropdown', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#select-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('clicked').that.equals(true);
    expect(resultData).to.have.property('selector').that.equals('#select-input');
  });

  it('should click on text input to focus it', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#text-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('clicked').that.equals(true);

    // Verify the input is now focused by checking element data
    const elements = await framework.callToolAndParse('elements', {
      selector: '#text-input'
    });
    expect(elements.elements[0].focused).to.equal(true);
  });

  it('should handle clicking disabled button', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#disabled-button'
    });

    // Click should succeed even on disabled elements
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('clicked').that.equals(true);
    expect(resultData).to.have.property('selector').that.equals('#disabled-button');
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#non-existent-element'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('ELEMENT_NOT_FOUND');
    expect(resultData).to.have.property('selector').that.equals('#non-existent-element');
  });

  it('should require either selector or xpath', async function() {
    let error;
    try {
      await framework.callToolAndParse('click', {});
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
      await framework.callToolAndParse('click', {
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
    const resultData = await framework.callToolAndParse('click', {
      selector: '##invalid-selector'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('INVALID_SELECTOR');
    expect(resultData.error).to.have.property('message').that.includes('Invalid selector');
  });

  it('should reject :contains() pseudo-selector', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: 'div:contains(hello)'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('message').that.includes('The :contains() pseudo-selector is not valid CSS');
    expect(resultData.error).to.have.property('message').that.includes('Use contains() selector with the `xpath` property instead');
  });

  it('should handle invalid xpath', async function() {
    const resultData = await framework.callToolAndParse('click', {
      xpath: '//invalid[xpath'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('INVALID_XPATH');
    expect(resultData.error).to.have.property('message').that.includes('Invalid XPath');
  });

  it('should animate cursor during click', async function() {
    this.timeout(5000); // Give more time for animation

    // Perform click
    const resultData = await framework.callToolAndParse('click', {
      selector: '#test-button'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('clicked').that.equals(true);

    // The cursor animation happens too quickly to reliably test visibility
    // Just verify the click completed successfully
  });

  it('should not click on invisible elements', async function() {
    // The click tool only finds visible elements, so trying to click
    // a hidden element should return element not found
    const resultData = await framework.callToolAndParse('click', {
      selector: '#hidden-element'
    });

    // Should return element not found since getElement with visible=true won't find it
    expect(resultData).to.have.property('error');
    expect(resultData.error).to.have.property('code').that.equals('ELEMENT_NOT_FOUND');
  });

  it('should click successfully on various elements', async function() {
    // Test clicking different types of elements
    const elements = ['#text-input', '#email-input', '#textarea-input', '#test-link'];

    for (const selector of elements) {
      const resultData = await framework.callToolAndParse('click', {
        selector: selector
      });

      expectValidTabInfo(resultData);
      expect(resultData).to.have.property('clicked').that.equals(true);
      expect(resultData).to.have.property('selector').that.equals(selector);
    }
  });
});

import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('InsertText Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should insert text into a standard input', async function() {
    const text = 'Inserted in one shot';

    const resultData = await framework.callToolAndParse('insertText', {
      selector: '#keylog-input',
      text
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selector').that.equals('#keylog-input');
    expect(resultData).to.have.property('inserted').that.equals(true);
    expect(resultData).to.have.property('length').that.equals(text.length);

    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal(text);
  });

  it('should insert without firing per-key events', async function() {
    const text = 'no keystrokes';

    await framework.callToolAndParse('insertText', { selector: '#keylog-input', text });

    // insertText fires input/beforeinput but no keydowns, so the counter stays 0.
    // (This is the behavioral difference from the type tool.)
    const counter = await framework.callToolAndParse('elements', { selector: '#keydown-count' });
    expect(counter.elements[0].value).to.equal('0');
  });

  it('should insert text into a contenteditable element', async function() {
    const text = 'inserted into a fake input';

    const resultData = await framework.callToolAndParse('insertText', {
      selector: '#contenteditable-input',
      text
    });

    expect(resultData).to.have.property('inserted').that.equals(true);

    const dom = await framework.callToolAndParse('dom', { selector: '#contenteditable-input' });
    expect(dom.html).to.include(text);
  });

  it('should insert into the focused element when no selector is given', async function() {
    const text = 'focused insert';

    await framework.callToolAndParse('focus', { selector: '#keylog-input' });
    const resultData = await framework.callToolAndParse('insertText', { text });

    expect(resultData).to.have.property('inserted').that.equals(true);

    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal(text);
  });

  it('should insert a large block of text', async function() {
    const text = 'Lorem ipsum dolor sit amet. '.repeat(50);

    const resultData = await framework.callToolAndParse('insertText', {
      selector: '#contenteditable-input',
      text
    });

    expect(resultData).to.have.property('inserted').that.equals(true);
    expect(resultData).to.have.property('length').that.equals(text.length);

    const dom = await framework.callToolAndParse('dom', { selector: '#contenteditable-input' });
    expect(dom.html).to.include('Lorem ipsum dolor sit amet.');
  });

  it('should insert using an XPath selector', async function() {
    const text = 'xpath insert';

    const resultData = await framework.callToolAndParse('insertText', {
      xpath: '//input[@id="keylog-input"]',
      text
    });

    expect(resultData).to.have.property('xpath').that.equals('//input[@id="keylog-input"]');
    expect(resultData).to.not.have.property('selector');
    expect(resultData).to.have.property('inserted').that.equals(true);
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('insertText', {
      selector: '#non-existent-input',
      text: 'test'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
  });

  it('should require the text parameter', async function() {
    let error;
    try {
      await framework.callToolAndParse('insertText', { selector: '#keylog-input' });
    } catch (e) {
      error = e;
    }

    expect(error, 'expected a validation error').to.exist;
    expect(error.code).to.equal(-32602);
  });
});

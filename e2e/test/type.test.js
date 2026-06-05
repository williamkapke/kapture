import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Type Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should type text into a standard input via individual keystrokes', async function() {
    const text = 'Hello, Kapture!';

    const resultData = await framework.callToolAndParse('type', {
      selector: '#keylog-input',
      text
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selector').that.equals('#keylog-input');
    expect(resultData).to.have.property('typed').that.equals(true);
    expect(resultData).to.have.property('length').that.equals(text.length);

    // The value was set
    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal(text);

    // ...and every character produced a real keydown (this is what fill can't do)
    const counter = await framework.callToolAndParse('elements', { selector: '#keydown-count' });
    expect(counter.elements[0].value).to.equal(String(text.length));
  });

  it('should type into a contenteditable element that ignores .value', async function() {
    const text = 'fake input typing';

    const resultData = await framework.callToolAndParse('type', {
      selector: '#contenteditable-input',
      text
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('typed').that.equals(true);

    // contenteditable has no .value - verify the text landed via its HTML
    const dom = await framework.callToolAndParse('dom', { selector: '#contenteditable-input' });
    expect(dom.html).to.include(text);
  });

  it('should type into the focused element when no selector is given', async function() {
    const text = 'focused typing';

    // Focus first, then type without a target
    await framework.callToolAndParse('focus', { selector: '#keylog-input' });
    const resultData = await framework.callToolAndParse('type', { text });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('typed').that.equals(true);

    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal(text);
  });

  it('should type printable special characters', async function() {
    const text = 'a B 1 ! @ # $ % ^ & * ( ) - _ = +';

    await framework.callToolAndParse('type', { selector: '#keylog-input', text });

    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal(text);
  });

  it('should respect a per-keystroke delay', async function() {
    const text = 'slow';

    const start = Date.now();
    await framework.callToolAndParse('type', { selector: '#keylog-input', text, delay: 100 });
    const elapsed = Date.now() - start;

    // 4 chars * 100ms = at least 400ms of inter-key waiting
    expect(elapsed).to.be.greaterThan(350);

    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal(text);
  });

  it('should type using an XPath selector', async function() {
    const text = 'xpath typing';

    const resultData = await framework.callToolAndParse('type', {
      xpath: '//input[@id="keylog-input"]',
      text
    });

    expect(resultData).to.have.property('xpath').that.equals('//input[@id="keylog-input"]');
    expect(resultData).to.not.have.property('selector');
    expect(resultData).to.have.property('typed').that.equals(true);
  });

  it('should append at the cursor without clearing existing content', async function() {
    await framework.callToolAndParse('type', { selector: '#keylog-input', text: 'abc' });
    await framework.callToolAndParse('type', { selector: '#keylog-input', text: 'def' });

    const input = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(input.elements[0].value).to.equal('abcdef');
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('type', {
      selector: '#non-existent-input',
      text: 'test'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
  });

  it('should require the text parameter', async function() {
    let error;
    try {
      await framework.callToolAndParse('type', { selector: '#keylog-input' });
    } catch (e) {
      error = e;
    }

    expect(error, 'expected a validation error').to.exist;
    expect(error.code).to.equal(-32602);
  });
});

import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Clear Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should clear a standard input', async function() {
    // Put a value in first
    await framework.callToolAndParse('fill', { selector: '#text-input', value: 'some text to remove' });

    const resultData = await framework.callToolAndParse('clear', { selector: '#text-input' });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selector').that.equals('#text-input');
    expect(resultData).to.have.property('cleared').that.equals(true);

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should clear a contenteditable element', async function() {
    // Type some content into the fake input
    await framework.callToolAndParse('type', { selector: '#contenteditable-input', text: 'remove me' });

    const before = await framework.callToolAndParse('dom', { selector: '#contenteditable-input' });
    expect(before.html).to.include('remove me');

    const resultData = await framework.callToolAndParse('clear', { selector: '#contenteditable-input' });
    expect(resultData).to.have.property('cleared').that.equals(true);

    const after = await framework.callToolAndParse('dom', { selector: '#contenteditable-input' });
    expect(after.html).to.not.include('remove me');
  });

  it('should clear the focused element when no selector is given', async function() {
    await framework.callToolAndParse('fill', { selector: '#text-input', value: 'focused clear' });
    await framework.callToolAndParse('focus', { selector: '#text-input' });

    const resultData = await framework.callToolAndParse('clear', {});
    expect(resultData).to.have.property('cleared').that.equals(true);

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should be a no-op on an already-empty field', async function() {
    const resultData = await framework.callToolAndParse('clear', { selector: '#text-input' });

    expect(resultData).to.have.property('cleared').that.equals(true);

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should clear using an XPath selector', async function() {
    await framework.callToolAndParse('fill', { selector: '#text-input', value: 'xpath clear' });

    const resultData = await framework.callToolAndParse('clear', {
      xpath: '//input[@id="text-input"]'
    });

    expect(resultData).to.have.property('xpath').that.equals('//input[@id="text-input"]');
    expect(resultData).to.not.have.property('selector');
    expect(resultData).to.have.property('cleared').that.equals(true);

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('clear', {
      selector: '#non-existent-input'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
  });
});

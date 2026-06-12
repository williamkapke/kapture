import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo, delay } from './helpers.js';

describe('Dialog Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
    await delay(500);
  });

  afterEach(async function() {
    // Best effort: never leave a dialog blocking the tab for the next test
    await framework.callTool('dialog', { accept: true }).catch(() => {});
  });

  it('should report a dialog opened by a click instead of timing out', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#confirm-button'
    });

    expect(resultData).to.have.property('dialog');
    expect(resultData.dialog.type).to.equal('confirm');
    expect(resultData.dialog.message).to.equal('Confirm test?');
    expect(resultData).to.have.property('warning').that.includes('dialog tool');
  });

  it('should fail other commands fast with DIALOG_OPEN while a dialog is up', async function() {
    await framework.callToolAndParse('click', { selector: '#confirm-button' });

    const blocked = await framework.callToolAndParse('elements', {
      selector: '#dialog-result'
    });
    expect(blocked).to.have.property('error');
    expect(blocked.error.code).to.equal('DIALOG_OPEN');
    expect(blocked.error.message).to.include('Confirm test?');
  });

  it('should accept a confirm dialog and unblock the page', async function() {
    await framework.callToolAndParse('click', { selector: '#confirm-button' });

    const handled = await framework.callToolAndParse('dialog', { accept: true });
    expect(handled).to.have.property('handled').that.equals(true);
    expect(handled.type).to.equal('confirm');

    await delay(200);
    const dom = await framework.callToolAndParse('dom', { selector: '#dialog-result' });
    expect(dom.html).to.include('confirm: true');
  });

  it('should dismiss a confirm dialog with accept false', async function() {
    await framework.callToolAndParse('click', { selector: '#confirm-button' });
    await framework.callToolAndParse('dialog', { accept: false });

    await delay(200);
    const dom = await framework.callToolAndParse('dom', { selector: '#dialog-result' });
    expect(dom.html).to.include('confirm: false');
  });

  it('should answer a prompt dialog with text', async function() {
    await framework.callToolAndParse('click', { selector: '#prompt-button' });

    const handled = await framework.callToolAndParse('dialog', {
      accept: true,
      text: 'hello from kapture'
    });
    expect(handled).to.have.property('handled').that.equals(true);

    await delay(200);
    const dom = await framework.callToolAndParse('dom', { selector: '#dialog-result' });
    expect(dom.html).to.include('prompt: hello from kapture');
  });

  it('should close an alert', async function() {
    const resultData = await framework.callToolAndParse('click', {
      selector: '#alert-button'
    });
    expect(resultData.dialog.type).to.equal('alert');

    await framework.callToolAndParse('dialog', { accept: true });

    await delay(200);
    const dom = await framework.callToolAndParse('dom', { selector: '#dialog-result' });
    expect(dom.html).to.include('alert: closed');

    // And the tab is fully functional again
    const elements = await framework.callToolAndParse('elements', { selector: 'h1' });
    expectValidTabInfo(elements);
    expect(elements.elements).to.have.lengthOf(1);
  });

  it('should report NO_DIALOG when nothing is open', async function() {
    const resultData = await framework.callToolAndParse('dialog', { accept: true });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('NO_DIALOG');
  });
});

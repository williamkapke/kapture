import { expect } from 'chai';
import { framework } from '../test-framework.js';

describe('Compose Tool Tests', function() {
  beforeEach(async function() {
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should run a sequence of commands in order and return an array', async function() {
    const script = [
      'fill?selector=%23text-input&value=hello+compose',
      'click?selector=%23test-button'
    ].join('\n');

    const results = await framework.callToolAndParse('compose', { script });

    expect(results).to.be.an('array').with.lengthOf(2);
    expect(results[0]).to.include({ command: 'fill', success: true });
    expect(results[1]).to.include({ command: 'click', success: true });

    // fill applied ('+' decodes to a space)
    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value).to.equal('hello compose');

    // button click ran its handler
    const dom = await framework.callToolAndParse('dom', { selector: '#click-result' });
    expect(dom.html).to.include('clicked');
  });

  it('should stop at the first failure and not run later commands', async function() {
    const script = [
      'fill?selector=%23text-input&value=stays',
      'click?selector=%23does-not-exist',
      'fill?selector=%23text-input&value=SHOULD_NOT_APPLY'
    ].join('\n');

    const results = await framework.callToolAndParse('compose', { script });

    // first ran, second failed, third never ran
    expect(results).to.be.an('array').with.lengthOf(2);
    expect(results[0].success).to.equal(true);
    expect(results[1].success).to.equal(false);
    expect(results[1].error.code).to.equal('ELEMENT_NOT_FOUND');

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value).to.equal('stays');
  });

  it('should support wait between steps', async function() {
    const script = [
      'fill?selector=%23text-input&value=a',
      'wait?t=400',
      'fill?selector=%23text-input&value=b'
    ].join('\n');

    const start = Date.now();
    const results = await framework.callToolAndParse('compose', { script });
    const elapsed = Date.now() - start;

    expect(elapsed).to.be.greaterThan(350);
    expect(results).to.have.lengthOf(3);
    expect(results[1]).to.include({ command: 'wait', success: true, waited: 400 });

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value).to.equal('b');
  });

  it('should reject an ineligible command and run nothing', async function() {
    const script = [
      'fill?selector=%23text-input&value=should_not_run',
      'evaluate?code=1'
    ].join('\n');

    const res = await framework.callToolAndParse('compose', { script });

    // Whole script rejected up front - returns an error, not a results array
    expect(res).to.have.property('error');
    expect(res.error.message).to.include('eligible');

    // nothing executed
    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should reject an invalid script before running anything', async function() {
    const script = [
      'fill?selector=%23text-input&value=ok',
      'fill?selector=%23text-input'  // missing required value
    ].join('\n');

    const res = await framework.callToolAndParse('compose', { script });

    expect(res).to.have.property('error');
    expect(res.error.message).to.match(/Line 2/);

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should url-decode special characters in values', async function() {
    const script = 'fill?selector=%23text-input&value=a%20b%26c%3Dd';

    const results = await framework.callToolAndParse('compose', { script });
    expect(results[0].success).to.equal(true);

    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value).to.equal('a b&c=d');
  });

  it('should coerce numeric args (scroll coordinates)', async function() {
    const results = await framework.callToolAndParse('compose', { script: 'scroll?y=300' });

    expect(results).to.have.lengthOf(1);
    expect(results[0]).to.include({ command: 'scroll', success: true });
    expect(results[0].scrollPosition.y).to.equal(300);
  });

  it('should require the script parameter', async function() {
    let error;
    try {
      await framework.callToolAndParse('compose', {});
    } catch (e) {
      error = e;
    }
    expect(error, 'expected a validation error').to.exist;
    expect(error.code).to.equal(-32602);
  });

  it('should run every element-action tool through compose', async function() {
    // focus, fill, clear, type, insertText, select, hover, blur, keypress, click, scroll
    const script = [
      'focus?selector=%23text-input',
      'fill?selector=%23text-input&value=hello',
      'clear?selector=%23text-input',
      'type?selector=%23keylog-input&text=typed',
      'insertText?selector=%23contenteditable-input&text=inserted',
      'select?selector=%23select-input&value=option2',
      'hover?selector=%23hover-box-1',
      'blur?selector=%23keylog-input',
      'keypress?key=Tab',
      'click?selector=%23test-button',
      'scroll?y=150'
    ].join('\n');

    const results = await framework.callToolAndParse('compose', { script });

    expect(results).to.be.an('array').with.lengthOf(11);
    results.forEach((r, idx) => {
      expect(r.success, `step ${idx} (${r.command}) failed: ${JSON.stringify(r.error || '')}`).to.equal(true);
    });

    // spot-check that a few actually applied
    const keylog = await framework.callToolAndParse('elements', { selector: '#keylog-input' });
    expect(keylog.elements[0].value).to.equal('typed');
    const sel = await framework.callToolAndParse('elements', { selector: '#select-input' });
    expect(sel.elements[0].value).to.equal('option2');
    const ce = await framework.callToolAndParse('dom', { selector: '#contenteditable-input' });
    expect(ce.html).to.include('inserted');
  });

  it('should allow a data-returning command as the final step', async function() {
    const script = [
      'fill?selector=%23text-input&value=verify+me',
      'elements?selector=%23text-input'
    ].join('\n');

    const results = await framework.callToolAndParse('compose', { script });

    expect(results).to.be.an('array').with.lengthOf(2);
    expect(results[1].command).to.equal('elements');
    expect(results[1].success).to.equal(true);
    expect(results[1].elements[0].value).to.equal('verify me');
  });

  it('should return dom content from a terminal dom step', async function() {
    const script = [
      'click?selector=%23test-button',
      'dom?selector=%23click-result'
    ].join('\n');

    const results = await framework.callToolAndParse('compose', { script });

    expect(results[1].command).to.equal('dom');
    expect(results[1].html).to.include('clicked');
  });

  it('should carry a terminal screenshot through as an image content block', async function() {
    const script = [
      'scroll?y=0',
      'screenshot?scale=0.2'
    ].join('\n');

    const res = await framework.callTool('compose', { script });

    expect(res.content).to.have.lengthOf(2);
    expect(res.content[1].type).to.equal('image');
    expect(res.content[1].data).to.be.a('string').that.is.not.empty;

    const results = JSON.parse(res.content[0].text);
    expect(results[1].command).to.equal('screenshot');
    expect(results[1].success).to.equal(true);
    expect(results[1]).to.have.property('preview');
  });

  it('should coerce integer args in a terminal console_logs step', async function() {
    const results = await framework.callToolAndParse('compose', { script: 'console_logs?limit=5' });

    expect(results).to.have.lengthOf(1);
    expect(results[0].command).to.equal('console_logs');
    expect(results[0].success).to.equal(true);
    expect(results[0].logs).to.be.an('array');
  });

  it('should reject a data-returning command that is not the final step', async function() {
    const script = [
      'elements?selector=%23text-input',
      'fill?selector=%23text-input&value=SHOULD_NOT_APPLY'
    ].join('\n');

    const res = await framework.callToolAndParse('compose', { script });

    expect(res).to.have.property('error');
    expect(res.error.message).to.include('final command');

    // nothing executed
    const input = await framework.callToolAndParse('elements', { selector: '#text-input' });
    expect(input.elements[0].value || '').to.equal('');
  });

  it('should run the navigation tools through compose', async function() {
    // navigate (encoded url), then the bare/no-query forms reload, back, forward
    const script = [
      'navigate?url=' + encodeURIComponent('http://localhost:61822/test.html?nav=1'),
      'reload',
      'back',
      'forward'
    ].join('\n');

    const results = await framework.callToolAndParse('compose', { script });

    expect(results).to.be.an('array').with.lengthOf(4);
    expect(results.map(r => r.command)).to.deep.equal(['navigate', 'reload', 'back', 'forward']);
    results.forEach((r, idx) => {
      expect(r.success, `step ${idx} (${r.command}) failed`).to.equal(true);
    });
    // forward lands back on the ?nav=1 page
    expect(results[3].url).to.include('nav=1');
  });
});

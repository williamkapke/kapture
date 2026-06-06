import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Back/Forward Tool Tests', function() {
  // Build a deterministic two-entry history before each test.
  beforeEach(async function() {
    await framework.callTool('navigate', { url: 'http://localhost:61822/test.html?page=1' });
    await framework.callTool('navigate', { url: 'http://localhost:61822/test.html?page=2' });
  });

  it('should navigate back to the previous page', async function() {
    const result = await framework.callToolAndParse('back', {});

    expectValidTabInfo(result);
    expect(result.success).to.equal(true);
    expect(result.url).to.include('page=1');
  });

  it('should navigate forward after going back', async function() {
    await framework.callToolAndParse('back', {});           // -> page=1
    const result = await framework.callToolAndParse('forward', {});

    expectValidTabInfo(result);
    expect(result.success).to.equal(true);
    expect(result.url).to.include('page=2');
  });

  it('should survive a back/forward round trip', async function() {
    const back = await framework.callToolAndParse('back', {});
    expect(back.url).to.include('page=1');

    const forward = await framework.callToolAndParse('forward', {});
    expect(forward.url).to.include('page=2');

    // and back again still works
    const backAgain = await framework.callToolAndParse('back', {});
    expect(backAgain.url).to.include('page=1');
  });
});

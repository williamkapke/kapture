import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Scroll Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should scroll an element into view', async function() {
    const result = await framework.callTool('scroll', {
      selector: '#anchor1'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('scrolled').that.equals(true);
    expect(resultData.scrollPosition.y).to.be.greaterThan(0);
  });

  it('should scroll the document to an absolute coordinate', async function() {
    const result = await framework.callTool('scroll', { y: 400 });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData.scrolled).to.equal(true);
    expect(resultData.scrollPosition.y).to.equal(400);
  });

  it('should scroll within an element when selector and coordinates are combined', async function() {
    const result = await framework.callTool('scroll', {
      selector: '#scrollable-area',
      y: 300
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData.scrolled).to.equal(true);
    expect(resultData).to.have.property('elementScroll');
    expect(resultData.elementScroll.y).to.equal(300);
    // Only the inner pane moved - the document itself stayed put
    expect(resultData.scrollPosition.y).to.equal(0);
  });

  it('should clamp element scroll to the scrollable extent', async function() {
    const result = await framework.callTool('scroll', {
      selector: '#scrollable-area',
      y: 99999
    });

    const resultData = JSON.parse(result.content[0].text);
    expect(resultData.scrolled).to.equal(true);
    expect(resultData.elementScroll.y).to.be.greaterThan(0);
    expect(resultData.elementScroll.y).to.be.lessThan(99999);
  });

  it('should keep the other axis when only one coordinate is given', async function() {
    await framework.callTool('scroll', { selector: '#scrollable-area', y: 150 });
    const result = await framework.callTool('scroll', { selector: '#scrollable-area', x: 0 });

    const resultData = JSON.parse(result.content[0].text);
    expect(resultData.elementScroll.y).to.equal(150); // y untouched by the x-only call
  });

  it('should require a target', async function() {
    const result = await framework.callTool('scroll', {});

    const resultData = JSON.parse(result.content[0].text);
    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('SCROLL_TARGET_REQUIRED');
  });

  it('should report element not found', async function() {
    const result = await framework.callTool('scroll', {
      selector: '#does-not-exist',
      y: 100
    });

    const resultData = JSON.parse(result.content[0].text);
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
  });
});

import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Elements Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should get elements by CSS selector', async function() {
    const result = await framework.callTool('elements', {
      selector: 'h1'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selector').that.equals('h1');
    expect(resultData).to.have.property('elements').that.is.an('array');
    expect(resultData.elements).to.have.lengthOf(1);

    const element = resultData.elements[0];
    expect(element).to.have.property('tagName').that.equals('h1');
    expect(element).to.have.property('selector').that.is.a('string');
    expect(element).to.have.property('bounds').that.is.an('object');
    expect(element.bounds).to.have.all.keys('x', 'y', 'width', 'height');
    expect(element).to.have.property('visible').that.is.a('boolean');
  });

  it('should get multiple elements', async function() {
    // Test page has multiple p elements
    const result = await framework.callTool('elements', {
      selector: 'p'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData.elements).to.be.an('array');
    expect(resultData.elements.length).to.be.greaterThan(1);

    // Check that we got multiple p elements
    resultData.elements.forEach((element) => {
      expect(element).to.have.property('tagName').that.equals('p');
      expect(element).to.have.property('visible').that.is.a('boolean');
    });
  });

  it('should get elements by XPath', async function() {
    const result = await framework.callTool('elements', {
      xpath: '//h1'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('xpath').that.equals('//h1');
    expect(resultData).to.not.have.property('selector');
    expect(resultData).to.have.property('elements').that.is.an('array');
    expect(resultData.elements).to.have.lengthOf(1);
    expect(resultData.elements[0].tagName).to.equal('h1');
  });

  it('should filter by visibility', async function() {
    // Test page has visible and hidden elements
    // Get all div elements in the visibility test section
    const allResult = await framework.callTool('elements', {
      selector: '#visible-element, #hidden-element, #zero-height'
    });

    const allData = JSON.parse(allResult.content[0].text);
    expect(allData.elements).to.have.lengthOf(3);

    // Get only visible elements
    const visibleResult = await framework.callTool('elements', {
      selector: '#visible-element, #hidden-element, #zero-height',
      visible: 'true'
    });

    const visibleData = JSON.parse(visibleResult.content[0].text);
    expectValidTabInfo(visibleData);
    expect(visibleData).to.have.property('visible').that.equals('true');
    expect(visibleData.elements).to.have.lengthOf(1);
    expect(visibleData.elements[0].id).to.equal('visible-element');
    expect(visibleData.elements[0].visible).to.equal(true);
  });

  it('should return empty array when no elements match', async function() {
    const result = await framework.callTool('elements', {
      selector: '.non-existent-class'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('elements').that.is.an('array');
    expect(resultData.elements).to.have.lengthOf(0);
  });

  it('should handle complex CSS selectors', async function() {
    // Test page has form elements with specific attributes
    const result = await framework.callTool('elements', {
      selector: 'input[type="text"]'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    // #text-input plus the #form-input inside the Enter-submit test form
    expect(resultData.elements).to.have.lengthOf(2);
    const ids = resultData.elements.map(e => e.id);
    expect(ids).to.include('text-input');
    expect(ids).to.include('form-input');
    for (const element of resultData.elements) {
      expect(element).to.have.property('tagName').that.equals('input');
    }
  });

  it('should handle complex XPath expressions', async function() {
    // Find buttons that are not disabled
    const result = await framework.callTool('elements', {
      xpath: '//button[not(@disabled)]'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData.elements.length).to.be.greaterThan(0);

    // Verify we got buttons
    resultData.elements.forEach(element => {
      expect(element).to.have.property('tagName').that.equals('button');
    });
  });

  it('should handle invalid CSS selector', async function() {
    const result = await framework.callTool('elements', {
      selector: '!!!invalid>>>'
    });

    const resultData = JSON.parse(result.content[0].text);
    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('INVALID_SELECTOR');
  });

  it('should handle invalid XPath', async function() {
    const result = await framework.callTool('elements', {
      xpath: '//[invalid'
    });

    const resultData = JSON.parse(result.content[0].text);
    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('INVALID_XPATH');
  });

  it('should require either selector or xpath', async function() {
    let error;
    try {
      await framework.callTool('elements', {});
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
      await framework.callTool('elements', {
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

  it('should correctly detect visibility of elements outside parent overflow bounds', async function() {
    // Test the overflow-escape element that uses fixed positioning to escape parent's overflow:hidden
    const result = await framework.callTool('elements', {
      selector: '#overflow-escape'
    });

    const resultData = JSON.parse(result.content[0].text);
    expectValidTabInfo(resultData);
    expect(resultData.elements).to.have.lengthOf(1);

    const element = resultData.elements[0];
    expect(element.id).to.equal('overflow-escape');

    // This element should be visible because it uses fixed positioning
    // to escape the parent's overflow:hidden constraint
    expect(element.visible).to.equal(true);

    // Also test with visibility filter
    const visibleResult = await framework.callTool('elements', {
      selector: '#overflow-escape',
      visible: 'true'
    });

    const visibleData = JSON.parse(visibleResult.content[0].text);
    expect(visibleData.elements).to.have.lengthOf(1);
    expect(visibleData.elements[0].visible).to.equal(true);
  });
});

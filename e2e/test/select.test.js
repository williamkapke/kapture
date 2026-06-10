import { expect } from 'chai';
import { framework } from '../test-framework.js';
import { expectValidTabInfo } from './helpers.js';

describe('Select Tool Tests', function() {
  beforeEach(async function() {
    // Navigate to test page to ensure clean state
    await framework.callTool('navigate', {
      url: "http://localhost:61822/test.html"
    });
  });

  it('should select option by value', async function() {
    const resultData = await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: 'option2'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selector').that.equals('#select-input');
    expect(resultData).to.have.property('selected').that.equals(true);

    // Verify the value was actually selected
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#select-input'
    });
    expect(elementData.elements[0].value).to.equal('option2');
  });

  it('should select first option when value is empty string', async function() {
    // First select a non-empty option
    await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: 'option3'
    });

    // Then select empty value (first option)
    const resultData = await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: ''
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selected').that.equals(true);
  });

  it('should select using XPath selector', async function() {
    const resultData = await framework.callToolAndParse('select', {
      xpath: '//select[@id="select-input"]',
      value: 'option1'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('xpath').that.equals('//select[@id="select-input"]');
    expect(resultData).to.not.have.property('selector');
    expect(resultData).to.have.property('selected').that.equals(true);
  });

  it('should return all options when getting select element', async function() {
    // Get all options using elements tool
    const resultData = await framework.callToolAndParse('elements', {
      selector: '#select-input'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('elements').that.is.an('array');
    expect(resultData.elements).to.have.lengthOf(1);

    const selectElement = resultData.elements[0];
    expect(selectElement).to.have.property('options').that.is.an('array');
    expect(selectElement.options).to.have.lengthOf(4);

    // Check each option (they include index property)
    const options = selectElement.options;
    expect(options[0]).to.include({ index: 0, value: '', text: 'Choose an option', selected: true, disabled: false });
    expect(options[1]).to.include({ index: 1, value: 'option1', text: 'Option 1', selected: false, disabled: false });
    expect(options[2]).to.include({ index: 2, value: 'option2', text: 'Option 2', selected: false, disabled: false });
    expect(options[3]).to.include({ index: 3, value: 'option3', text: 'Option 3', selected: false, disabled: false });
  });

  it('should handle element not found', async function() {
    const resultData = await framework.callToolAndParse('select', {
      selector: '#non-existent-select',
      value: 'option1'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('ELEMENT_NOT_FOUND');
    expect(resultData).to.have.property('selector').that.equals('#non-existent-select');
  });

  it('should handle non-select elements', async function() {
    // Try to select on a non-select element
    const resultData = await framework.callToolAndParse('select', {
      selector: '#text-input',
      value: 'option1'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('INVALID_ELEMENT');
    expect(resultData.error.message).to.include('Element is not fillable');
  });

  it('should handle invalid option value', async function() {
    const resultData = await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: 'non-existent-option'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('OPTION_NOT_FOUND');
    expect(resultData.error.message).to.include('Option not found');
    expect(resultData.error.message).to.include('non-existent-option');
  });

  it('should not select option by text (only by value)', async function() {
    // Select only works with value, not text
    const resultData = await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: 'Option 3'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('OPTION_NOT_FOUND');
    expect(resultData.error.message).to.include('Option not found with value: Option 3');
  });

  it('should trigger change event', async function() {
    // First select an option to ensure a change will occur
    await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: 'option1'
    });

    // Now select a different option
    const resultData = await framework.callToolAndParse('select', {
      selector: '#select-input',
      value: 'option2'
    });

    expectValidTabInfo(resultData);
    expect(resultData).to.have.property('selected').that.equals(true);

    // Verify the value changed
    const elementData = await framework.callToolAndParse('elements', {
      selector: '#select-input'
    });
    expect(elementData.elements[0].value).to.equal('option2');
  });

  it('should require either selector or xpath', async function() {
    let error;
    try {
      await framework.callToolAndParse('select', {
        value: 'option1'
      });
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
      await framework.callToolAndParse('select', {
        value: 'option1',
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

  it('should handle select with no options', async function() {
    // Test with the empty select that's already on the page
    const resultData = await framework.callToolAndParse('select', {
      selector: '#empty-select',
      value: 'any'
    });

    expect(resultData).to.have.property('error');
    expect(resultData.error.code).to.equal('OPTION_NOT_FOUND');
  });
});

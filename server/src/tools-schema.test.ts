import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allTools } from './yaml-loader.js';

// Regression guard: the Anthropic Messages API (and OpenAI strict mode) reject
// oneOf/allOf/anyOf at the top level of a tool's input_schema. A
// session once "fixed" the loader by re-adding the YAML oneOf onto the advertised
// schema; validation kept working (it runs off a Zod refine), so every behavioral
// test stayed green while the schema 400'd every Claude request. This test checks
// the advertised schema directly, independent of validation behavior, so the
// combinator can't silently come back.
test('no tool advertises oneOf/allOf/anyOf at the top level of its inputSchema', () => {
  const offenders = allTools
    .filter(tool => tool.jsonSchema?.oneOf || tool.jsonSchema?.allOf || tool.jsonSchema?.anyOf)
    .map(tool => tool.name);

  assert.deepEqual(
    offenders,
    [],
    `These tools advertise a top-level combinator the Anthropic API rejects: ${offenders.join(', ')}. ` +
    `Enforce the constraint in the Zod refine instead of the advertised schema (see yaml-loader.ts).`
  );
});

// click/hover accept a third targeting mode - viewport coordinates - which is
// mutually exclusive with selector/xpath and requires both axes.
test('click/hover accept exactly one targeting mode: selector, xpath, or x+y', () => {
  for (const name of ['click', 'hover']) {
    const tool = allTools.find(t => t.name === name);
    assert.ok(tool, `${name} tool not found`);
    const ok = (args: any) => tool.inputSchema.safeParse(args).success;

    assert.equal(ok({ tabId: 't', selector: '#a' }), true, `${name}: selector`);
    assert.equal(ok({ tabId: 't', xpath: '//a' }), true, `${name}: xpath`);
    assert.equal(ok({ tabId: 't', x: 10, y: 20 }), true, `${name}: coordinates`);

    assert.equal(ok({ tabId: 't' }), false, `${name}: no target`);
    assert.equal(ok({ tabId: 't', selector: '#a', xpath: '//a' }), false, `${name}: both selector and xpath`);
    assert.equal(ok({ tabId: 't', x: 10 }), false, `${name}: x without y`);
    assert.equal(ok({ tabId: 't', selector: '#a', x: 10, y: 20 }), false, `${name}: selector and coordinates`);
  }
});

// Tools without coordinate support keep the strict selector/xpath constraint
test('selector/xpath-only tools still reject stray combinations', () => {
  const tool = allTools.find(t => t.name === 'fill');
  assert.ok(tool, 'fill tool not found');
  const ok = (args: any) => tool.inputSchema.safeParse(args).success;

  assert.equal(ok({ tabId: 't', selector: '#a', value: 'v' }), true);
  assert.equal(ok({ tabId: 't', value: 'v' }), false, 'fill: no target');
  assert.equal(ok({ tabId: 't', selector: '#a', xpath: '//a', value: 'v' }), false, 'fill: both');
});

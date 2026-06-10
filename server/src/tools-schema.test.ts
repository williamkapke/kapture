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

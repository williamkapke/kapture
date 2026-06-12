import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComposeScript, executeCompose } from './compose.js';

// Data-returning commands are allowed in compose, but only as the final
// command - act, then verify in one call.

test('a data-returning command is accepted as the final command', () => {
  const steps = parseComposeScript('click?selector=%23go\nscreenshot', 'tab1');
  assert.deepEqual(steps.map(s => s.command), ['click', 'screenshot']);
});

test('a data-returning command anywhere else rejects the whole script', () => {
  assert.throws(
    () => parseComposeScript('elements?selector=body\nclick?selector=%23go', 'tab1'),
    /Line 1: 'elements' returns data and may only be the final command/
  );
});

test('every terminal read parses with its own args', () => {
  const script = [
    'screenshot?selector=%23panel&scale=0.5',
    'dom?selector=%23result',
    'elements?selector=.item&visible=true',
    'elementsFromPoint?x=10&y=20',
    'console_logs?level=error&limit=20',
    'watch_console?timeout=2000'
  ];
  for (const line of script) {
    const steps = parseComposeScript(line, 'tab1');
    assert.equal(steps.length, 1, line);
  }
});

test('integer args are coerced from their query-string form', () => {
  // console_logs limit is type integer (not number) - regression guard for
  // the parser only coercing type:number
  const steps = parseComposeScript('console_logs?limit=20', 'tab1');
  assert.strictEqual(steps[0].args.limit, 20);
});

test('non-tab and lifecycle tools stay ineligible', () => {
  for (const name of ['list_tabs', 'tab_detail', 'new_tab', 'close', 'show', 'evaluate']) {
    assert.throws(
      () => parseComposeScript(name, 'tab1'),
      /not an eligible compose command/,
      name
    );
  }
});

test('executeCompose surfaces a terminal screenshot image content block', async () => {
  const callTool = async (name: string) => {
    if (name === 'screenshot') {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: true, preview: 'http://x/view' }) },
          { type: 'image', mimeType: 'image/webp', data: 'BASE64' }
        ]
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
  };

  const { results, image } = await executeCompose(
    { script: 'scroll?y=0\nscreenshot', tabId: 'tab1' },
    callTool
  );
  assert.equal(results.length, 2);
  assert.equal(results[1].command, 'screenshot');
  assert.deepEqual(image, { type: 'image', mimeType: 'image/webp', data: 'BASE64' });
});

test('executeCompose returns no image when the script ends in an action', async () => {
  const callTool = async () => ({ content: [{ type: 'text', text: JSON.stringify({ success: true }) }] });
  const { image } = await executeCompose({ script: 'scroll?y=0', tabId: 'tab1' }, callTool);
  assert.equal(image, undefined);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../src/transcriptParse.js';

const line = (o) => JSON.stringify(o);

test('user string content → one text bubble', () => {
  const msgs = parseTranscript([line({ type: 'user', message: { role: 'user', content: '你好' } })]);
  assert.deepEqual(msgs, [{ i: 0, role: 'user', type: 'text', text: '你好' }]);
});

test('assistant text + thinking split into two messages', () => {
  const msgs = parseTranscript([line({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: '想…' }, { type: 'text', text: '答' }] },
  })]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].type, 'thinking');
  assert.equal(msgs[1].type, 'text');
  assert.equal(msgs[1].text, '答');
});

test('tool_use pairs with its later tool_result by id', () => {
  const msgs = parseTranscript([
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb', is_error: false }] } }),
  ]);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].type, 'tool');
  assert.equal(msgs[0].tool.name, 'Bash');
  assert.equal(msgs[0].tool.result, 'a\nb');
  assert.equal(msgs[0].tool.isError, false);
});

test('internal types and blank/bad lines are skipped', () => {
  const msgs = parseTranscript([
    '', '  ', 'not json',
    line({ type: 'system', foo: 1 }),
    line({ type: 'ai-title', title: 'x' }),
    line({ type: 'user', message: { role: 'user', content: '留' } }),
  ]);
  assert.deepEqual(msgs.map((m) => m.text), ['留']);
});

test('tool_result with array content concatenates text parts', () => {
  const msgs = parseTranscript([
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'X' }, { type: 'text', text: 'Y' }] }] } }),
  ]);
  assert.equal(msgs[0].tool.result, 'XY');
});

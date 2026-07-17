import { describe, it, expect } from 'vitest';
import { parseTranscript } from '../src/transcriptParse.js';

const line = (o) => JSON.stringify(o);

describe('parseTranscript', () => {
  it('user string content → one text bubble', () => {
    const msgs = parseTranscript([line({ type: 'user', message: { role: 'user', content: '你好' } })]);
    expect(msgs).toEqual([{ i: 0, role: 'user', type: 'text', text: '你好' }]);
  });

  it('assistant text + thinking split into two messages', () => {
    const msgs = parseTranscript([line({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'thinking', thinking: '想…' }, { type: 'text', text: '答' }] },
    })]);
    expect(msgs.length).toBe(2);
    expect(msgs[0].type).toBe('thinking');
    expect(msgs[1].type).toBe('text');
    expect(msgs[1].text).toBe('答');
  });

  it('tool_use pairs with its later tool_result by id', () => {
    const msgs = parseTranscript([
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb', is_error: false }] } }),
    ]);
    expect(msgs.length).toBe(1);
    expect(msgs[0].type).toBe('tool');
    expect(msgs[0].tool.name).toBe('Bash');
    expect(msgs[0].tool.result).toBe('a\nb');
    expect(msgs[0].tool.isError).toBe(false);
  });

  it('folds structuredPatch into tool.diff (added/removed counts + hunks)', () => {
    const msgs = parseTranscript([
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: '/a.js' } }] } }),
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok', is_error: false }] },
        toolUseResult: { structuredPatch: [{ oldStart: 1, newStart: 1, lines: [' ctx', '-gone', '+new', '+more'] }] },
      }),
    ]);
    expect(msgs[0].tool.diff).toEqual({
      added: 2, removed: 1,
      hunks: [{ oldStart: 1, newStart: 1, lines: [' ctx', '-gone', '+new', '+more'] }],
    });
  });

  it('a create (empty patch) counts every content line as added', () => {
    const msgs = parseTranscript([
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: '/n.js' } }] } }),
      line({
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', content: 'created', is_error: false }] },
        toolUseResult: { type: 'create', content: 'a\nb\nc', structuredPatch: [] },
      }),
    ]);
    expect(msgs[0].tool.diff).toEqual({ added: 3, removed: 0, hunks: null, created: true });
  });

  it('a non-edit tool (Bash) has no diff', () => {
    const msgs = parseTranscript([
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'out' }] }, toolUseResult: { stdout: 'out' } }),
    ]);
    expect(msgs[0].tool.diff).toBe(null);
  });

  it('internal types and blank/bad lines are skipped', () => {
    const msgs = parseTranscript([
      '', '  ', 'not json',
      line({ type: 'system', foo: 1 }),
      line({ type: 'ai-title', title: 'x' }),
      line({ type: 'user', message: { role: 'user', content: '留' } }),
    ]);
    expect(msgs.map((m) => m.text)).toEqual(['留']);
  });

  it('drops isMeta and isCompactSummary scaffolding turns', () => {
    const msgs = parseTranscript([
      line({ type: 'user', isMeta: true, message: { role: 'user', content: 'Base directory for this skill: /x' } }),
      line({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued…' } }),
      line({ type: 'user', message: { role: 'user', content: '真的问题' } }),
    ]);
    expect(msgs.map((m) => m.text)).toEqual(['真的问题']);
  });

  it('drops slash-command and local-command-stdout user turns by anchored tag', () => {
    const msgs = parseTranscript([
      line({ type: 'user', message: { role: 'user', content: '<command-name>/compact</command-name>\n<command-message>compact</command-message>' } }),
      line({ type: 'user', message: { role: 'user', content: '<local-command-stdout>Compacted</local-command-stdout>' } }),
      line({ type: 'user', message: { role: 'user', content: '真的问题' } }),
    ]);
    expect(msgs.map((m) => m.text)).toEqual(['真的问题']);
  });

  it('keeps an assistant reply that merely MENTIONS a command tag in prose (no false-positive)', () => {
    const msgs = parseTranscript([line({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '脚手架消息(`<command-name>`/`<local-command-stdout>`)本该被隐藏' }] },
    })]);
    expect(msgs.length).toBe(1);
    expect(msgs[0].text).toContain('<command-name>');
  });

  it('tool_result with array content concatenates text parts', () => {
    const msgs = parseTranscript([
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'X' }, { type: 'text', text: 'Y' }] }] } }),
    ]);
    expect(msgs[0].tool.result).toBe('XY');
  });
});

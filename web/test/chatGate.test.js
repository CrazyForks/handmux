// web/test/chatGate.test.js
import { describe, it, expect } from 'vitest';
import { pendingGate } from '../src/chatGate.js';

const toolMsg = (name, input = {}) => ({ i: 0, role: 'assistant', type: 'tool', tool: { name, input, result: null, isError: false } });

describe('pendingGate', () => {
  it('returns null when not blocked (kind !== permission)', () => {
    expect(pendingGate([toolMsg('Bash')], 'working')).toBe(null);
  });

  it('generic tool permission → allow/deny buttons', () => {
    const g = pendingGate([toolMsg('Bash', { command: 'ls' })], 'permission');
    expect(g.type).toBe('permission');
    expect(g.options.map((o) => o.label)).toEqual(['允许', '拒绝']);
    expect(g.options[0].keys.length).toBeGreaterThan(0);
  });

  it('AskUserQuestion → one button per option', () => {
    const q = { question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] };
    const g = pendingGate([toolMsg('AskUserQuestion', { questions: [q] })], 'permission');
    expect(g.type).toBe('question');
    expect(g.prompt).toBe('选哪个？');
    expect(g.options.map((o) => o.label)).toEqual(['A', 'B', 'C']);
    // 第 3 个选项的键序比第 1 个长（需要多按方向键）
    expect(g.options[2].keys.length).toBeGreaterThan(g.options[0].keys.length);
  });

  it('ExitPlanMode → null (P1 excludes plan approval)', () => {
    expect(pendingGate([toolMsg('ExitPlanMode', { plan: '…' })], 'permission')).toBe(null);
  });

  it('uses the LAST tool_use to decide the gate', () => {
    const g = pendingGate([toolMsg('AskUserQuestion', { questions: [{ options: [{ label: 'A' }] }] }), toolMsg('Bash')], 'permission');
    expect(g.type).toBe('permission'); // 最后一个是 Bash
  });
});

import { describe, it, expect } from 'vitest';
import { parsePendingPrompt } from '../src/pendingPrompt.js';

// Real captures from a live Claude Code (2026-07-17).
const ASK_MENU = [
  '✻ Worked for 9s',
  '',
  ' ☐ 颜色',
  '',
  '你喜欢哪个?',
  '',
  '❯ 1. 红色',
  '     热情、醒目',
  '  2. 蓝色',
  '     沉稳、冷静',
  '  3. 绿色',
  '     自然、清新',
  '  4. Type something.',
  '  5. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
  '  manual mode on · 3 agents',
].join('\n');

const PERM_MENU = [
  'Bash command',
  '  rm -rf build/',
  '',
  'Do you want to proceed?',
  '❯ 1. Yes',
  "  2. Yes, and don't ask again this session",
  '  3. No, and tell Claude what to do differently (esc)',
  '',
  'Enter to select · Esc to cancel',
].join('\n');

// Multi-question: a tab strip, showing the CURRENT tab's question + options. ☒ = answered tab.
const MULTI_Q2 = [
  '✻ Cooked for 12s',
  '❯ some prompt echo',
  '────────────────────────────────',
  '←  ☒ 水果  ☐ 颜色  ✔ Submit  →',
  '选个颜色?',
  '❯ 1. 红',
  '  2. 蓝',
  '  3. Type something.',
  'Enter to select · Tab/Arrow keys to navigate · Esc to cancel',
].join('\n');

// The review/submit screen — has options but NO footer line.
const REVIEW = [
  '✻ Cooked for 12s',
  '────────────────────────────────',
  '←  ☒ 水果  ☒ 颜色  ✔ Submit  →',
  'Review your answers',
  ' ● 选水果?',
  '   → 苹果',
  ' ● 选颜色?',
  '   → 红',
  'Ready to submit your answers?',
  '❯ 1. Submit answers',
  '  2. Cancel',
].join('\n');

describe('parsePendingPrompt', () => {
  it('returns null when there is no menu (no ❯ cursor option) on screen', () => {
    expect(parsePendingPrompt('just some\nterminal output\n$ ')).toBeNull();
    expect(parsePendingPrompt('')).toBeNull();
  });

  it('parses a single AskUserQuestion: real options + descriptions + cursor, meta dropped', () => {
    const g = parsePendingPrompt(ASK_MENU);
    expect(g.kind).toBe('question');
    expect(g.title).toBe('颜色 — 你喜欢哪个?');
    expect(g.options).toEqual([
      { n: 1, label: '红色', description: '热情、醒目' },
      { n: 2, label: '蓝色', description: '沉稳、冷静' },
      { n: 3, label: '绿色', description: '自然、清新' },
    ]);
    expect(g.cursor).toBe(1);
    expect(g.multi).toBeUndefined(); // single question → no tab metadata
  });

  it('parses a tool-permission menu as kind "permission"', () => {
    const g = parsePendingPrompt(PERM_MENU);
    expect(g.kind).toBe('permission');
    expect(g.title).toContain('Do you want to proceed?');
    expect(g.options.map((o) => o.label)[0]).toBe('Yes');
    expect(g.options).toHaveLength(3);
  });

  it('parses a multi-question tab screen: current question + step/total, title excludes the tab bar', () => {
    const g = parsePendingPrompt(MULTI_Q2);
    expect(g.title).toBe('选个颜色?'); // tab strip + rule + prompt echo all excluded
    expect(g.options).toEqual([
      { n: 1, label: '红', description: '' },
      { n: 2, label: '蓝', description: '' },
    ]); // "Type something." dropped
    expect(g.multi).toBe(true);
    expect(g.total).toBe(2);
    expect(g.step).toBe(2);     // 水果 answered (☒) → now on question 2
    expect(g.submit).toBe(false);
  });

  it('parses the review/submit screen (no footer) via the ❯ cursor anchor', () => {
    const g = parsePendingPrompt(REVIEW);
    expect(g.options).toEqual([
      { n: 1, label: 'Submit answers', description: '' },
      { n: 2, label: 'Cancel', description: '' },
    ]);
    expect(g.multi).toBe(true);
    expect(g.submit).toBe(true); // both tabs ☒ + option 1 is "Submit answers"
  });

  it('handles an options-only menu with no descriptions', () => {
    const g = parsePendingPrompt(['Pick one', '❯ 1. A', '  2. B', 'Esc to cancel'].join('\n'));
    expect(g.options).toEqual([
      { n: 1, label: 'A', description: '' },
      { n: 2, label: 'B', description: '' },
    ]);
    expect(g.title).toBe('Pick one');
  });

  // leadIn: the assistant text preceding the menu. The jsonl turn isn't flushed until AFTER the answer, so
  // this scrape is the 对话 lens's only way to show why a question is being asked. The title walk stops at
  // the first boundary (spinner/rule) — leadIn continues past it and keeps the text's last lines.
  it('leadIn — text above a spinner/rule boundary surfaces as the gate context (the reported bug)', () => {
    const g = parsePendingPrompt([
      '⏺ 探完了现有骨架,关键发现是后端零件基本齐全',
      '  所以推荐直接复用现有管线。',
      '',
      '✻ Worked for 9s',
      '────────────────────────────────',
      '你喜欢哪个方案?',
      '❯ 1. 方案A',
      '  2. 方案B',
      'Enter to select · Esc to cancel',
    ].join('\n'));
    expect(g.title).toBe('你喜欢哪个方案?'); // boundary keeps the title clean…
    expect(g.leadIn).toBe('探完了现有骨架,关键发现是后端零件基本齐全 所以推荐直接复用现有管线。'); // …but the text still shows
  });

  it('leadIn — adjacent text the title cannot absorb (⏺ is a boundary) surfaces as leadIn instead', () => {
    const g = parsePendingPrompt([
      '⏺ 验证标记 ABC123 这段是问题前的正文',
      '',
      '你喜欢哪个?',
      '❯ 1. 红色',
      '  2. 蓝色',
      'Enter to select · Esc to cancel',
    ].join('\n'));
    expect(g.title).toBe('你喜欢哪个?');                          // title stops at the ⏺ boundary…
    expect(g.leadIn).toBe('验证标记 ABC123 这段是问题前的正文');   // …and the text lands in leadIn
  });

  it('leadIn never crosses the user’s own ❯ prompt echo (that would be stale prior-exchange text)', () => {
    const g = parsePendingPrompt([
      '⏺ 上一轮的回答,与当前问题无关',
      '',
      '❯ 帮我选个颜色',
      '✻ Worked for 3s',
      '────────────────────────────────',
      '你喜欢哪个?',
      '❯ 1. 红色',
      '  2. 蓝色',
      'Enter to select · Esc to cancel',
    ].join('\n'));
    expect(g.leadIn).toBeUndefined(); // nothing between the prompt echo and the menu → no leadIn
  });

  it('leadIn — keeps only the LAST lines of a long preceding block', () => {
    const g = parsePendingPrompt([
      '⏺ 第一行结论',
      '  中间论证省略',
      '  最后一行才是重点',
      '✻ Cogitated for 4s',
      '────────────────────────────────',
      '选哪个?',
      '❯ 1. A',
      '  2. B',
      'Enter to select · Esc to cancel',
    ].join('\n'));
    expect(g.leadIn).toBe('中间论证省略 最后一行才是重点'); // capped at 2 lines, ⏺ stripped
  });

  it('no leadIn when nothing precedes the menu', () => {
    expect(parsePendingPrompt(ASK_MENU).leadIn).toBeUndefined();
    expect(parsePendingPrompt(PERM_MENU).leadIn).toBeUndefined(); // tool-call lines above a permission are not prose
  });
});

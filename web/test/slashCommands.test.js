import { describe, it, expect } from 'vitest';
import { shouldHandOffSlash } from '../src/slashCommands.js';

describe('shouldHandOffSlash', () => {
  it('hands off for a bare interactive builtin', () => {
    expect(shouldHandOffSlash('/model')).toBe(true);
    expect(shouldHandOffSlash('/effort')).toBe(true); // the one that was missed before
    expect(shouldHandOffSlash('/plugin')).toBe(true);
    expect(shouldHandOffSlash('  /agents  ')).toBe(true); // surrounding whitespace tolerated
  });

  it('hands off for ANY unrecognized bare slash command (the safe fallback)', () => {
    expect(shouldHandOffSlash('/some-unknown-plugin-cmd')).toBe(true);
    expect(shouldHandOffSlash('/whatever')).toBe(true);
  });

  it('stays in chat for a known inline one-shot command', () => {
    expect(shouldHandOffSlash('/clear')).toBe(false);
    expect(shouldHandOffSlash('/compact')).toBe(false);
    expect(shouldHandOffSlash('/cost')).toBe(false);
    expect(shouldHandOffSlash('/status')).toBe(false);
  });

  it('stays in chat once the command carries args (applies directly, no picker)', () => {
    expect(shouldHandOffSlash('/model sonnet')).toBe(false);
    expect(shouldHandOffSlash('/effort xhigh')).toBe(false);
    expect(shouldHandOffSlash('/goal ship the login page')).toBe(false); // custom command WITH input
  });

  it('stays for non-slash messages and paths (never a false hand-off)', () => {
    expect(shouldHandOffSlash('帮我改一下 /model 的逻辑')).toBe(false); // slash not at the start
    expect(shouldHandOffSlash('/Users/demo/foo.js')).toBe(false); // a path (segment has a trailing part)
    expect(shouldHandOffSlash('')).toBe(false);
    expect(shouldHandOffSlash(null)).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dotConfigured, dotBlock, tmuxDotStatus, installTmuxDot, tmuxScriptsDir } from '../src/cli/tmuxConf.js';
import { tmpHome } from './tmphome.js';

describe('dotConfigured (pure)', () => {
  it('false for a conf that never references @claude_dot', () => {
    expect(dotConfigured('set -g mouse on\n')).toBe(false);
    expect(dotConfigured('')).toBe(false);
  });
  it('true when @claude_dot appears anywhere (our block OR a hand-rolled config)', () => {
    expect(dotConfigured("set -g window-status-format '#{@claude_dot}#I:#W'")).toBe(true);
    expect(dotConfigured(dotBlock())).toBe(true);
  });
});

describe('dotBlock (pure)', () => {
  it('wires @claude_dot + seed/seen scripts at the stable ~/.handmux/tmux path', () => {
    const home = '/home/tester';
    const b = dotBlock(home);
    const dir = tmuxScriptsDir(home);
    expect(b).toContain('@claude_dot');
    expect(b).toContain('>>> handmux claude-dot >>>');
    expect(b).toContain('<<< handmux claude-dot <<<');
    expect(b).toMatch(/window-status-format/);
    // references the scripts via the stable home path (NOT a repo checkout that breaks on move)
    expect(dir).toContain('.handmux');
    expect(b).toContain(`${dir}/claude-tab-seed.py`);
    expect(b).toContain(`${dir}/claude-tab-seen.sh`);
    expect(b).toContain('after-select-window');
    expect(b).toContain('pane-focus-in');
  });
});

describe('tmuxDotStatus (IO)', () => {
  it("'absent' when ~/.tmux.conf is missing or has no dot config", () => {
    const home = tmpHome('twtc-');
    expect(tmuxDotStatus(home)).toBe('absent');
    fs.writeFileSync(path.join(home, '.tmux.conf'), 'set -g mouse on\n');
    expect(tmuxDotStatus(home)).toBe('absent');
  });
  it("'present' when ~/.tmux.conf already wires @claude_dot", () => {
    const home = tmpHome('twtc-');
    fs.writeFileSync(path.join(home, '.tmux.conf'), dotBlock());
    expect(tmuxDotStatus(home)).toBe('present');
  });
});

describe('installTmuxDot (IO)', () => {
  it('creates ~/.tmux.conf with the block AND copies the scripts to ~/.handmux/tmux', () => {
    const home = tmpHome('twtc-');
    const res = installTmuxDot(home);
    expect(res.status).toBe('installed');
    const text = fs.readFileSync(path.join(home, '.tmux.conf'), 'utf8');
    expect(dotConfigured(text)).toBe(true);
    expect(tmuxDotStatus(home)).toBe('present');
    // the enhancement scripts landed at the stable path the block points to
    const dir = tmuxScriptsDir(home);
    expect(fs.existsSync(path.join(dir, 'claude-tab-seed.py'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'claude-tab-seen.sh'))).toBe(true);
    expect(text).toContain(dir);
  });
  it('appends to an existing conf, preserving the user content', () => {
    const home = tmpHome('twtc-');
    fs.writeFileSync(path.join(home, '.tmux.conf'), 'set -g mouse on\n');
    installTmuxDot(home);
    const text = fs.readFileSync(path.join(home, '.tmux.conf'), 'utf8');
    expect(text).toContain('set -g mouse on');
    expect(dotConfigured(text)).toBe(true);
  });
  it('is idempotent — a second install does not duplicate the block', () => {
    const home = tmpHome('twtc-');
    installTmuxDot(home);
    const res2 = installTmuxDot(home);
    expect(res2.status).toBe('present'); // already there → no-op
    const text = fs.readFileSync(path.join(home, '.tmux.conf'), 'utf8');
    expect(text.match(/>>> handmux claude-dot >>>/g)).toHaveLength(1);
  });
});

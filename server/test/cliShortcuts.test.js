import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpHome } from './tmphome.js';
import {
  buildShortcutKey, moveShortcut, saveShortcutConfig, runShortcutEditor,
} from '../src/cli/shortcutEditor.js';

describe('shortcut editor model', () => {
  it('builds canonical tmux keys and friendly labels from picked parts', () => {
    expect(buildShortcutKey('none', 'Escape')).toEqual({ type: 'key', key: 'Escape', label: 'Esc' });
    expect(buildShortcutKey('shift', 'Tab')).toEqual({ type: 'key', key: 'BTab', label: 'Shift+Tab' });
    expect(buildShortcutKey('ctrl-alt', 'r')).toEqual({ type: 'key', key: 'C-M-r', label: 'Ctrl+Alt+R' });
    expect(buildShortcutKey('ctrl-shift', 'Up')).toEqual({ type: 'key', key: 'C-S-Up', label: 'Ctrl+Shift+Up' });
  });

  it('rejects a bare character because that belongs to a text shortcut', () => {
    expect(() => buildShortcutKey('none', 'a')).toThrow(/modifier/);
  });

  it('moves one configured shortcut directly to any final position', () => {
    const items = [
      { type: 'text', text: 'a', enter: false },
      { type: 'text', text: 'b', enter: true },
      { type: 'text', text: 'c', enter: true },
      { type: 'text', text: 'd', enter: true },
    ];
    expect(moveShortcut(items, 3, 0).map((item) => item.text)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveShortcut(items, 0, 3).map((item) => item.text)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveShortcut(items, 3, 1).map((item) => item.text)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveShortcut(items, 0, 2).map((item) => item.text)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveShortcut(items, 1, 1)).toEqual(items);
    expect(items.map((item) => item.text)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('atomically writes shortcuts while preserving every unrelated config field', () => {
    const home = tmpHome('tw-shortcuts-');
    const target = path.join(home, '.handmux', 'config.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ tunnel: 'none', token: 'keep', staticDir: '/srv' }));

    saveShortcutConfig(target, { command: [], chat: [{ type: 'text', text: 'ok', enter: true }] });

    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({
      tunnel: 'none', token: 'keep', staticDir: '/srv',
      shortcuts: { command: [], chat: [{ type: 'text', text: 'ok', enter: true }] },
    });
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });
});

describe('runShortcutEditor', () => {
  it('moves a shortcut to a selected final position in one operation', async () => {
    const home = tmpHome('tw-shortcuts-move-');
    const target = path.join(home, '.handmux', 'config.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ shortcuts: {
      command: [
        { type: 'text', text: 'a', enter: false },
        { type: 'text', text: 'b', enter: false },
        { type: 'text', text: 'c', enter: false },
        { type: 'text', text: 'd', enter: false },
      ],
      chat: [],
    } }));
    const answers = ['command', 'item:1', 'move', 2, 'back', 'save'];
    const selectCalls = [];
    const ui = {
      intro: vi.fn(), outro: vi.fn(), cancel: vi.fn(),
      select: vi.fn((options) => { selectCalls.push(options); return { kind: 'select', options }; }),
      text: vi.fn((options) => ({ kind: 'text', options })),
      confirm: vi.fn((options) => ({ kind: 'confirm', options })),
      ask: vi.fn(async () => answers.shift()),
    };

    const result = await runShortcutEditor({ target, running: false, isTTY: true, ui });

    expect(result.cfg.shortcuts.command.map((item) => item.text)).toEqual(['a', 'c', 'b', 'd']);
    const actionMenu = selectCalls.find((call) => call.options.some((option) => option.value === 'move'));
    expect(actionMenu.options.some((option) => option.value === 'move')).toBe(true);
    const positionMenu = selectCalls.find((call) => call.options.some((option) => option.value === 0));
    expect(positionMenu.options).toEqual([
      { value: 0, label: '1 · First' },
      { value: 2, label: '3 · After c' },
      { value: 3, label: '4 · Last' },
    ]);
  });

  it('does not offer moving when a mode has only one shortcut', async () => {
    const home = tmpHome('tw-shortcuts-one-');
    const target = path.join(home, '.handmux', 'config.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify({ shortcuts: {
      command: [{ type: 'text', text: 'only', enter: false }], chat: [],
    } }));
    const answers = ['command', 'item:0', 'back', 'back', 'exit'];
    const selectCalls = [];
    const ui = {
      intro: vi.fn(), outro: vi.fn(), cancel: vi.fn(),
      select: vi.fn((options) => { selectCalls.push(options); return { kind: 'select', options }; }),
      text: vi.fn((options) => ({ kind: 'text', options })),
      confirm: vi.fn((options) => ({ kind: 'confirm', options })),
      ask: vi.fn(async () => answers.shift()),
    };

    await runShortcutEditor({ target, running: false, isTTY: true, ui });

    const itemMenu = selectCalls.find((call) => call.message === 'only');
    expect(itemMenu.options.some((option) => option.value === 'move')).toBe(false);
  });

  it('guides a text shortcut from mode selection through Enter behavior and save', async () => {
    const home = tmpHome('tw-shortcuts-ui-');
    const target = path.join(home, '.handmux', 'config.json');
    const answers = ['command', 'add-text', 'git status', true, 'back', 'save'];
    const selectCalls = [];
    const ui = {
      intro: vi.fn(), outro: vi.fn(), cancel: vi.fn(),
      select: vi.fn((options) => { selectCalls.push(options); return { kind: 'select', options }; }),
      text: vi.fn((options) => ({ kind: 'text', options })),
      confirm: vi.fn((options) => ({ kind: 'confirm', options })),
      ask: vi.fn(async () => answers.shift()),
    };

    const result = await runShortcutEditor({ target, running: false, isTTY: true, ui });

    expect(result).toMatchObject({ restart: false });
    expect(result.cfg.shortcuts.command).toEqual([
      { type: 'text', text: 'git status', enter: true },
    ]);
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).shortcuts.command).toEqual(result.cfg.shortcuts.command);
    expect(ui.outro).toHaveBeenCalled();
    const modeMenu = selectCalls.find((call) => call.options.some((option) => option.value === 'add-text'));
    expect(modeMenu.options.map((option) => option.value)).toContain('add-key');
    expect(modeMenu.options.map((option) => option.value)).not.toContain('add');
  });

  it('adds a key directly without asking for its shortcut type first', async () => {
    const home = tmpHome('tw-shortcuts-key-ui-');
    const target = path.join(home, '.handmux', 'config.json');
    const answers = ['command', 'add-key', 'none', 'Escape', 'back', 'save'];
    const ui = {
      intro: vi.fn(), outro: vi.fn(), cancel: vi.fn(),
      select: vi.fn((options) => ({ kind: 'select', options })),
      text: vi.fn((options) => ({ kind: 'text', options })),
      confirm: vi.fn((options) => ({ kind: 'confirm', options })),
      ask: vi.fn(async () => answers.shift()),
    };

    const result = await runShortcutEditor({ target, running: false, isTTY: true, ui });

    expect(result.cfg.shortcuts.command).toEqual([
      { type: 'key', key: 'Escape', label: 'Esc' },
    ]);
  });

  it('refuses non-interactive input instead of hanging', async () => {
    const log = { error: vi.fn() };
    expect(await runShortcutEditor({ target: '/unused', isTTY: false, log })).toEqual({ error: 'non-tty' });
    expect(log.error).toHaveBeenCalledOnce();
  });

  it('the CLI exits non-zero when shortcuts has no interactive terminal', () => {
    const home = tmpHome('tw-shortcuts-no-tty-');
    const bin = fileURLToPath(new URL('../bin/handmux.js', import.meta.url));
    const result = spawnSync(process.execPath, [bin, 'shortcuts'], {
      env: { ...process.env, HOME: home, LANG: 'en_US.UTF-8' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('interactive terminal');
  });
});

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeCodexNotify, stripCodexNotify,
  codexHooksStatus, installCodexHooks, uninstallCodexHooks,
} from '../src/cli/codexHooks.js';

const OURS = 'notify = ["node", "/home/u/.codex/hooks/handmux-codex-notify.cjs"]';

describe('mergeCodexNotify (pure)', () => {
  it('prepends the notify line to an empty / notify-less config', () => {
    expect(mergeCodexNotify('', OURS)).toEqual({ conflict: false, text: OURS + '\n' });
    const withTable = '[tui]\nnotifications = ["agent-turn-complete"]\n';
    const out = mergeCodexNotify(withTable, OURS);
    expect(out.conflict).toBe(false);
    expect(out.text.startsWith(OURS + '\n')).toBe(true); // root key stays before the [tui] table
  });

  it('refreshes our own notify line in place (idempotent)', () => {
    const stale = 'notify = ["node", "/old/handmux-codex-notify.cjs"]\n[tui]\nx = 1\n';
    const out = mergeCodexNotify(stale, OURS);
    expect(out.conflict).toBe(false);
    expect(out.text).toBe(OURS + '\n[tui]\nx = 1\n');
  });

  it("refuses to clobber the user's own notify program", () => {
    const foreign = 'notify = ["/usr/local/bin/chime"]\n';
    expect(mergeCodexNotify(foreign, OURS)).toEqual({ conflict: true, text: null });
  });

  it('treats a notify under a [table] as a different key (root slot is free)', () => {
    const tabled = '[something]\nnotify = ["x"]\n';
    const out = mergeCodexNotify(tabled, OURS);
    expect(out.conflict).toBe(false);
    expect(out.text.startsWith(OURS + '\n')).toBe(true);
  });
});

describe('stripCodexNotify (pure)', () => {
  it('removes our line but leaves a foreign notify', () => {
    expect(stripCodexNotify(OURS + '\n[tui]\nx = 1\n')).toBe('[tui]\nx = 1\n');
    const foreign = 'notify = ["/usr/local/bin/chime"]\n[tui]\nx = 1\n';
    expect(stripCodexNotify(foreign)).toBe(foreign);
  });
});

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cxh-')); }
const srcDir = path.resolve(new URL('../hooks', import.meta.url).pathname);

describe('installCodexHooks / status / uninstall (IO)', () => {
  it("reports no-codex and does nothing when ~/.codex doesn't exist", () => {
    const home = tmpHome();
    expect(codexHooksStatus(home)).toBe('no-codex');
    expect(installCodexHooks(home, { srcDir, stateFile: '/x' }).status).toBe('no-codex');
    expect(fs.existsSync(path.join(home, '.codex'))).toBe(false); // never created
  });

  it('installs: writes the notify key, copies the script, pins the state file', () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    const stateFile = path.join(home, '.handmux', 'claude-state.json');
    expect(codexHooksStatus(home)).toBe('absent');

    const r = installCodexHooks(home, { srcDir, stateFile });
    expect(r.status).toBe('installed');
    expect(codexHooksStatus(home)).toBe('installed');

    const toml = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(toml).toContain('handmux-codex-notify.cjs');
    expect(fs.existsSync(path.join(home, '.codex', 'hooks', 'handmux-codex-notify.cjs'))).toBe(true);
    expect(fs.readFileSync(path.join(home, '.codex', 'hooks', 'handmux-codex-notify.env'), 'utf8'))
      .toBe(`HANDMUX_STATE=${stateFile}\n`);

    // idempotent: a second install refreshes, status stays installed, no duplicate notify line
    installCodexHooks(home, { srcDir, stateFile });
    const again = fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8');
    expect(again.match(/notify\s*=/g)).toHaveLength(1);
  });

  it("refuses (conflict) when the user already has a notify, leaving config.toml untouched", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    const foreign = 'notify = ["/usr/local/bin/chime"]\n';
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), foreign);
    expect(codexHooksStatus(home)).toBe('conflict');
    expect(installCodexHooks(home, { srcDir, stateFile: '/x' }).status).toBe('conflict');
    expect(fs.readFileSync(path.join(home, '.codex', 'config.toml'), 'utf8')).toBe(foreign);
  });

  it('uninstall strips our notify and removes the copied files', () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    installCodexHooks(home, { srcDir, stateFile: path.join(home, '.handmux', 's.json') });
    uninstallCodexHooks(home);
    expect(codexHooksStatus(home)).toBe('absent');
    expect(fs.existsSync(path.join(home, '.codex', 'hooks', 'handmux-codex-notify.cjs'))).toBe(false);
  });
});

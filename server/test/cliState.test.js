import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readState, writeState, clearState, isAlive, statePath, claudeStatePath, pushStorePath, previewStorePath } from '../src/cli/state.js';

let home;
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-')); });
afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

describe('state', () => {
  it('round-trips through ~/.handmux/state.json', () => {
    writeState({ supervisorPid: 123, publicUrl: 'x' }, home);
    expect(readState(home)).toEqual({ supervisorPid: 123, publicUrl: 'x' });
    expect(fs.existsSync(statePath(home))).toBe(true);
  });
  it('readState returns null when missing or corrupt', () => {
    expect(readState(home)).toBeNull();
    fs.mkdirSync(path.dirname(statePath(home)), { recursive: true });
    fs.writeFileSync(statePath(home), 'not json');
    expect(readState(home)).toBeNull();
  });
  it('clearState removes the file and is idempotent', () => {
    writeState({ a: 1 }, home);
    clearState(home);
    expect(readState(home)).toBeNull();
    expect(() => clearState(home)).not.toThrow();
  });
  it('isAlive reports on the current process and rejects bogus pids', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(0)).toBe(false);
    expect(isAlive(2 ** 30)).toBe(false);
  });
  it('claudeStatePath is ~/.handmux/claude-state.json', () => {
    expect(claudeStatePath('/home/x')).toBe('/home/x/.handmux/claude-state.json');
  });
  it('push/preview stores live in ~/.handmux (survive a global reinstall)', () => {
    expect(pushStorePath('/home/x')).toBe('/home/x/.handmux/push-subs.json');
    expect(previewStorePath('/home/x')).toBe('/home/x/.handmux/previews.json');
  });
});

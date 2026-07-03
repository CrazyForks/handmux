import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome } from './tmphome.js';
import {
  statusLineStatus, installStatusLine, uninstallStatusLine, composeHint,
} from '../src/cli/statusLine.js';

const SRC = path.resolve(__dirname, '../hooks'); // bundled scripts (has handmux-statusline.cjs)

function withClaude(prefix) {
  const home = tmpHome(prefix);
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}
function settings(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
}
function writeSettings(home, obj) {
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(obj));
}
const usageFile = (home) => path.join(home, '.handmux', 'claude-usage.json');

describe('statusLineStatus', () => {
  it("'no-claude' when ~/.claude is absent", () => {
    expect(statusLineStatus(tmpHome('sl-'))).toBe('no-claude');
  });
  it("'absent' when Claude is present but has no statusLine", () => {
    expect(statusLineStatus(withClaude('sl-'))).toBe('absent');
  });
  it("'foreign' when the user has their own statusLine", () => {
    const home = withClaude('sl-');
    writeSettings(home, { statusLine: { type: 'command', command: 'bash ~/.claude/mystatus.sh' } });
    expect(statusLineStatus(home)).toBe('foreign');
  });
  it("'ours' when our capturer is installed", () => {
    const home = withClaude('sl-');
    installStatusLine(home, { srcDir: SRC, usageFile: usageFile(home) });
    expect(statusLineStatus(home)).toBe('ours');
  });
});

describe('installStatusLine', () => {
  it('installs when absent: copies the script + points settings.statusLine at it', () => {
    const home = withClaude('sl-');
    const r = installStatusLine(home, { srcDir: SRC, usageFile: usageFile(home) });
    expect(r.status).toBe('installed');
    expect(fs.existsSync(path.join(home, '.claude', 'hooks', 'handmux-statusline.cjs'))).toBe(true);
    const sl = settings(home).statusLine;
    expect(sl.type).toBe('command');
    expect(sl.command).toContain('handmux-statusline.cjs');
    expect(sl.command).toContain(usageFile(home));
  });

  it('NEVER clobbers a foreign statusLine', () => {
    const home = withClaude('sl-');
    writeSettings(home, { statusLine: { type: 'command', command: 'bash ~/.claude/mystatus.sh' } });
    const r = installStatusLine(home, { srcDir: SRC, usageFile: usageFile(home) });
    expect(r.status).toBe('foreign');
    expect(settings(home).statusLine.command).toBe('bash ~/.claude/mystatus.sh'); // untouched
    expect(fs.existsSync(path.join(home, '.claude', 'hooks', 'handmux-statusline.cjs'))).toBe(false);
  });

  it("'no-claude' and does nothing when ~/.claude is absent", () => {
    const home = tmpHome('sl-');
    expect(installStatusLine(home, { srcDir: SRC, usageFile: usageFile(home) }).status).toBe('no-claude');
    expect(fs.existsSync(path.join(home, '.claude'))).toBe(false);
  });

  it('preserves other settings keys', () => {
    const home = withClaude('sl-');
    writeSettings(home, { model: 'opus', hooks: { Stop: [] } });
    installStatusLine(home, { srcDir: SRC, usageFile: usageFile(home) });
    const s = settings(home);
    expect(s.model).toBe('opus');
    expect(s.hooks).toEqual({ Stop: [] });
    expect(s.statusLine).toBeDefined();
  });
});

describe('uninstallStatusLine', () => {
  it('removes ours (settings key + script)', () => {
    const home = withClaude('sl-');
    installStatusLine(home, { srcDir: SRC, usageFile: usageFile(home) });
    uninstallStatusLine(home);
    expect(settings(home).statusLine).toBeUndefined();
    expect(fs.existsSync(path.join(home, '.claude', 'hooks', 'handmux-statusline.cjs'))).toBe(false);
  });

  it('leaves a foreign statusLine intact', () => {
    const home = withClaude('sl-');
    writeSettings(home, { statusLine: { type: 'command', command: 'bash ~/.claude/mystatus.sh' } });
    uninstallStatusLine(home);
    expect(settings(home).statusLine.command).toBe('bash ~/.claude/mystatus.sh');
  });
});

describe('composeHint', () => {
  it('is a TEE pipeline into the user\'s own statusline', () => {
    const home = withClaude('sl-');
    const hint = composeHint(home, { usageFile: usageFile(home) });
    expect(hint).toContain('HANDMUX_STATUS_TEE=1');
    expect(hint).toContain('handmux-statusline.cjs');
    expect(hint).toContain('<your existing statusline>');
  });
});

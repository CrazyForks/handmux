import { describe, it, expect } from 'vitest';
import { parseTmuxVersion, versionAtLeast, checkTmux, MIN_TMUX, tmuxInstallHint } from '../src/cli/tmuxVersion.js';

describe('parseTmuxVersion', () => {
  it('parses normal, suffixed, next- and openbsd- forms', () => {
    expect(parseTmuxVersion('tmux 3.6a')).toMatchObject({ major: 3, minor: 6, suffix: 'a', raw: '3.6a' });
    expect(parseTmuxVersion('tmux 3.4')).toMatchObject({ major: 3, minor: 4, suffix: '', raw: '3.4' });
    expect(parseTmuxVersion('tmux next-3.5')).toMatchObject({ major: 3, minor: 5 });
    expect(parseTmuxVersion('tmux openbsd-7.4')).toMatchObject({ major: 7, minor: 4 });
  });
  it('returns null on garbage', () => {
    expect(parseTmuxVersion('not tmux')).toBeNull();
    expect(parseTmuxVersion('')).toBeNull();
  });
});

describe('versionAtLeast', () => {
  it('compares on major.minor, ignoring the patch letter', () => {
    expect(versionAtLeast(parseTmuxVersion('tmux 3.6a'), '3.0')).toBe(true);
    expect(versionAtLeast(parseTmuxVersion('tmux 3.0'), '3.0')).toBe(true);
    expect(versionAtLeast(parseTmuxVersion('tmux 2.9'), '3.0')).toBe(false);
    expect(versionAtLeast(parseTmuxVersion('tmux 4.1'), '3.0')).toBe(true);
  });
  it('null version is never new enough', () => {
    expect(versionAtLeast(null, '3.0')).toBe(false);
  });
});

describe('checkTmux', () => {
  const exec = (out, status = 0) => () => ({ status, stdout: out, stderr: '' });
  it('reports present + ok for a modern tmux', () => {
    expect(checkTmux(exec('tmux 3.6a'))).toMatchObject({ present: true, ok: true, raw: '3.6a' });
  });
  it('flags an old tmux as present-but-not-ok', () => {
    expect(checkTmux(exec('tmux 2.8'))).toMatchObject({ present: true, ok: false });
  });
  it('reports absent when tmux -V fails', () => {
    expect(checkTmux(exec('', 127))).toEqual({ present: false });
  });
  it('MIN_TMUX is a sane version string', () => {
    expect(MIN_TMUX).toMatch(/^\d+\.\d+$/);
  });
});

describe('tmuxInstallHint', () => {
  const never = () => ({ status: 1 });                          // `which` finds nothing
  const onlyHas = (...bins) => (_cmd, args) => ({ status: bins.includes(args[0]) ? 0 : 1 });

  it('macOS → Homebrew', () => {
    expect(tmuxInstallHint(never, 'darwin')).toBe('brew install tmux');
  });
  it('Windows → points at WSL', () => {
    expect(tmuxInstallHint(never, 'win32')).toMatch(/WSL/);
  });
  it('Linux → the package manager that is actually present', () => {
    expect(tmuxInstallHint(onlyHas('apt-get'), 'linux')).toBe('sudo apt install tmux');
    expect(tmuxInstallHint(onlyHas('pacman'), 'linux')).toBe('sudo pacman -S tmux');
    expect(tmuxInstallHint(onlyHas('dnf'), 'linux')).toBe('sudo dnf install tmux');
  });
  it('Linux with no known package manager → a safe fallback', () => {
    expect(tmuxInstallHint(never, 'linux')).toMatch(/package manager/);
  });
});

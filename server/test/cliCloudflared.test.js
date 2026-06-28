import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assetFor, resolveCloudflared } from '../src/cli/cloudflared.js';

describe('assetFor', () => {
  it('maps macOS to a tgz', () => {
    expect(assetFor('darwin', 'arm64')).toEqual({ file: 'cloudflared-darwin-arm64.tgz', archive: 'tgz', bin: 'cloudflared' });
  });
  it('maps linux x64 to a bare amd64 binary', () => {
    expect(assetFor('linux', 'x64')).toEqual({ file: 'cloudflared-linux-amd64', archive: null, bin: 'cloudflared' });
  });
  it('maps windows to an .exe', () => {
    expect(assetFor('win32', 'x64')).toEqual({ file: 'cloudflared-windows-amd64.exe', archive: null, bin: 'cloudflared.exe' });
  });
});

describe('resolveCloudflared', () => {
  let home;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cf-')); });
  afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

  it('returns the $PATH binary without downloading', async () => {
    const bin = await resolveCloudflared(home, { which: () => '/usr/local/bin/cloudflared', fetchImpl: () => { throw new Error('should not fetch'); } });
    expect(bin).toBe('/usr/local/bin/cloudflared');
  });

  it('reuses an already-downloaded binary in ~/.handmux/bin', async () => {
    const dir = path.join(home, '.handmux', 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const existing = path.join(dir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    fs.writeFileSync(existing, 'binary');
    const bin = await resolveCloudflared(home, { which: () => null, fetchImpl: () => { throw new Error('should not fetch'); } });
    expect(bin).toBe(existing);
  });
});

import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserProfilePersistence } from '../src/browser/profilePersistence.js';

const DEVICE_A = 'device-a';
const DEVICE_B = 'device-b';

describe('browser profile persistence', () => {
  let root;
  let dir;
  let keyFile;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'handmux-browser-profile-'));
    dir = path.join(root, 'profiles');
    keyFile = path.join(dir, 'profile.key');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('encrypts one opaque file per device and restores only with the same key', async () => {
    const store = createBrowserProfilePersistence({ dir, keyFile });
    await store.write(DEVICE_A, '{"cookies":"sso-secret"}');
    const files = await fs.readdir(dir);
    const profileFile = files.find((name) => name.endsWith('.profile'));
    const raw = await fs.readFile(path.join(dir, profileFile), 'utf8');

    expect(raw).not.toContain('sso-secret');
    expect(await store.read(DEVICE_A)).toBe('{"cookies":"sso-secret"}');
    expect(await store.read(DEVICE_B)).toBeNull();
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(keyFile)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.join(dir, profileFile))).mode & 0o777).toBe(0o600);
  });

  it('rejects tampered ciphertext without returning partial data', async () => {
    const store = createBrowserProfilePersistence({ dir, keyFile });
    await store.write(DEVICE_A, '{"cookies":"value"}');
    const profileFile = (await fs.readdir(dir)).find((name) => name.endsWith('.profile'));
    const profilePath = path.join(dir, profileFile);
    const envelope = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    const ciphertext = Buffer.from(envelope.data, 'base64');
    ciphertext[0] ^= 0xff;
    envelope.data = ciphertext.toString('base64');
    await fs.writeFile(profilePath, JSON.stringify(envelope));

    await expect(store.read(DEVICE_A)).rejects.toThrow('browser profile authentication failed');
  });

  it('rejects a profile encrypted under a different key', async () => {
    const store = createBrowserProfilePersistence({ dir, keyFile });
    await store.write(DEVICE_A, '{"cookies":"value"}');
    await fs.writeFile(keyFile, randomBytes(32), { mode: 0o600 });
    const restarted = createBrowserProfilePersistence({ dir, keyFile });

    await expect(restarted.read(DEVICE_A)).rejects.toThrow('browser profile authentication failed');
  });

  it('writes through a same-directory unique temporary file, fsyncs, and renames', async () => {
    const opened = [];
    const injectedFs = {
      ...fs,
      open: vi.fn(async (...args) => {
        const handle = await fs.open(...args);
        const sync = vi.spyOn(handle, 'sync');
        opened.push({ file: args[0], mode: args[2], sync });
        return handle;
      }),
      rename: vi.fn((...args) => fs.rename(...args)),
    };
    const store = createBrowserProfilePersistence({ dir, keyFile, fs: injectedFs });

    await Promise.all([
      store.write(DEVICE_A, '{"cookies":"one"}'),
      store.write(DEVICE_A, '{"cookies":"two"}'),
    ]);

    const profileRenameCalls = injectedFs.rename.mock.calls.filter(([, target]) => target.endsWith('.profile'));
    expect(profileRenameCalls).toHaveLength(2);
    expect(new Set(profileRenameCalls.map(([temp]) => temp)).size).toBe(2);
    for (const [temp, target] of profileRenameCalls) {
      expect(path.dirname(temp)).toBe(dir);
      expect(path.dirname(target)).toBe(dir);
      expect(temp).not.toBe(target);
    }
    const profileHandles = opened.filter(({ file }) => String(file).includes('.profile.tmp-'));
    expect(profileHandles).toHaveLength(2);
    expect(profileHandles.every(({ mode, sync }) => mode === 0o600 && sync.mock.calls.length === 1)).toBe(true);
  });

  it('removes the unique temporary file after a write failure', async () => {
    let failedTemp = null;
    const injectedFs = {
      ...fs,
      open: vi.fn(async (...args) => {
        const handle = await fs.open(...args);
        if (!String(args[0]).includes('.profile.tmp-')) return handle;
        failedTemp = args[0];
        return {
          writeFile: vi.fn(async () => { throw new Error('disk full'); }),
          sync: handle.sync.bind(handle),
          close: handle.close.bind(handle),
        };
      }),
    };
    const store = createBrowserProfilePersistence({ dir, keyFile, fs: injectedFs });

    await expect(store.write(DEVICE_A, '{"cookies":"value"}')).rejects.toThrow('disk full');

    expect(failedTemp).not.toBeNull();
    await expect(fs.stat(failedTemp)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.readdir(dir)).filter((name) => name.endsWith('.profile'))).toEqual([]);
  });
});

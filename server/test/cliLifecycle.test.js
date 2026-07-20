import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpHome } from './tmphome.js';
import { writeState } from '../src/cli/state.js';
import { writeCache } from '../src/cli/updateCheck.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, '../bin/handmux.js');
const require = createRequire(import.meta.url);
const VERSION = require('../package.json').version;

function status(home) {
  return spawnSync(process.execPath, [CLI, 'status'], {
    env: { ...process.env, HOME: home, LANG: 'en_US.UTF-8' },
    encoding: 'utf8',
    timeout: 3000,
  });
}

describe('CLI lifecycle', () => {
  it('status shows the installed version and exits when stopped', () => {
    const r = status(tmpHome('hm-cli-'));
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`handmux ${VERSION} stopped`);
  });

  it('status distinguishes the running version after an upgrade and exits', () => {
    const home = tmpHome('hm-cli-');
    writeState({
      supervisorPid: process.pid,
      version: '0.1.0',
      tunnel: 'none',
      publicUrl: null,
      lanUrl: null,
      localUrl: 'http://localhost:19999',
      token: 'test-token',
    }, home);
    // Keep status on its cache-only hot path, without spawning the detached update worker in this test.
    writeCache(home, { checkedAt: Date.now(), latest: VERSION, whatsNew: null });

    const r = status(home);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('handmux 0.1.0 running');
    expect(r.stdout).toContain(`installed version ${VERSION} (takes effect after restart)`);
  });
});

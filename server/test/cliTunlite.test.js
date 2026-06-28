import { describe, it, expect } from 'vitest';
import { resolveTunlite, checkSshAuth } from '../src/cli/tunlite.js';

const okRun = () => ({ status: 0, stdout: 'tunlite 1.0.0' });

describe('resolveTunlite', () => {
  it('prefers the bundled binary when it exists', () => {
    const bin = resolveTunlite({ exists: () => true, bundled: '/x/node_modules/.bin/tunlite', run: okRun });
    expect(bin).toBe('/x/node_modules/.bin/tunlite');
  });
  it('falls back to PATH tunlite when no bundled binary', () => {
    expect(resolveTunlite({ exists: () => false, run: okRun })).toBe('tunlite');
  });
  it('throws a clear install hint when tunlite cannot run', () => {
    expect(() => resolveTunlite({ exists: () => false, run: () => ({ status: 127 }) })).toThrow(/tunlite not found/);
  });
});

describe('checkSshAuth', () => {
  it('returns the tunlite check exit status (0 = passwordless ready)', () => {
    expect(checkSshAuth('me@h', { run: () => ({ status: 0 }) })).toBe(0);
    expect(checkSshAuth('me@h', { run: () => ({ status: 4 }) })).toBe(4);
  });
});

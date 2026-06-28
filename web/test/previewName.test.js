import { describe, it, expect } from 'vitest';
import { previewSlug, previewName } from '../src/previewName.js';

describe('previewSlug', () => {
  it('keeps safe chars, collapses the rest to single dashes, trims, lowercases', () => {
    expect(previewSlug('My Sess!')).toBe('my-sess');   // lowercased (subdomain hosts are case-insensitive)
    expect(previewSlug('a__b')).toBe('a__b');     // underscores are safe
    expect(previewSlug('--x--')).toBe('x');
    expect(previewSlug('全中文')).toBe('');         // nothing safe → empty
    expect(previewSlug('@3')).toBe('3');
    expect(previewSlug('jly-Tunlite-0')).toBe('jly-tunlite-0');
  });
});

describe('previewName', () => {
  it('combines session + window name + window id, always non-empty & safe', () => {
    expect(previewName({ session: 'main', windowName: 'build', windowId: '@3' })).toBe('main-build-3');
    expect(previewName({ session: 'jly', windowName: 'Tunlite', windowId: '@0' })).toBe('jly-tunlite-0');
  });
  it('falls back to the window id when session/window are all non-ascii', () => {
    expect(previewName({ session: '编译', windowName: '前端', windowId: '@7' })).toBe('7');
  });
  it('uses w when even the id slugs empty (defensive)', () => {
    expect(previewName({ session: '', windowName: '', windowId: '' })).toBe('w');
  });
});

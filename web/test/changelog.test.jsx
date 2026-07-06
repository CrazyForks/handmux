import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Changelog from '../src/components/Changelog.jsx';
import { CHANGELOG, LATEST_RELEASE, entryId } from '../src/changelog.js';
import { getChangelogSeen, setChangelogSeen } from '../src/storage.js';

let container; let root;
beforeEach(() => { localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('changelog data', () => {
  it('LATEST_RELEASE is the newest entry id (its version)', () => {
    expect(LATEST_RELEASE).toBe(entryId(CHANGELOG[0]));
    expect(LATEST_RELEASE).toBe(CHANGELOG[0].version);
  });
  it('every entry id (version or date) is unique', () => {
    const ids = CHANGELOG.map(entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every public (versioned) entry carries a bilingual highlight for the update prompt', () => {
    for (const r of CHANGELOG.filter((e) => e.version)) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.highlight?.zh?.length).toBeGreaterThan(0);
      expect(r.highlight?.en?.length).toBeGreaterThan(0);
    }
  });
  it('seen getter/setter round-trips', () => {
    expect(getChangelogSeen()).toBeNull();
    setChangelogSeen(LATEST_RELEASE);
    expect(getChangelogSeen()).toBe(LATEST_RELEASE);
  });
});

describe('Changelog sheet', () => {
  it('renders nothing when closed', () => {
    act(() => root.render(<Changelog open={false} onClose={() => {}} />));
    expect(container.querySelector('.changelog-panel')).toBeNull();
  });
  it('lists every release with its items', () => {
    act(() => root.render(<Changelog open onClose={() => {}} />));
    expect(container.querySelectorAll('.rel')).toHaveLength(CHANGELOG.length);
    const items = container.querySelectorAll('.rel-items li');
    // items is now bilingual { zh, en }; the suite renders in zh (see test/setup.js).
    expect(items.length).toBe(CHANGELOG.reduce((n, r) => n + r.items.zh.length, 0));
  });
});

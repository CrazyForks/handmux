import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import Changelog from '../src/components/Changelog.jsx';
import { CHANGELOG, LATEST_RELEASE } from '../src/changelog.js';
import { getChangelogSeen, setChangelogSeen } from '../src/storage.js';

let container; let root;
beforeEach(() => { localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('changelog data', () => {
  it('LATEST_RELEASE is the newest entry id', () => {
    expect(LATEST_RELEASE).toBe(CHANGELOG[0].v);
  });
  it('has at most one entry per date (one paragraph per day)', () => {
    const dates = CHANGELOG.map((r) => r.date);
    expect(new Set(dates).size).toBe(dates.length);
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

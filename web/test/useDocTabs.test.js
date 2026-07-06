import { describe, it, expect } from 'vitest';
import { HOME_TAB, openDocState, refreshDocState, closeTabState } from '../src/hooks/useDocTabs.js';

const init = { tabs: [HOME_TAB], active: 'home' };

describe('openDocState', () => {
  it('appends a new doc tab and activates it', () => {
    const s = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: '# a' });
    expect(s.tabs.map((t) => t.key)).toEqual(['home', '/h/a.md']);
    expect(s.active).toBe('/h/a.md');
  });
  it('dedupes AND refreshes: re-opening an open path activates it and replaces its content', () => {
    const s1 = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: '# a' });
    const s2 = openDocState({ ...s1, active: 'home' }, '/h/a.md', { type: 'markdown', name: 'a.md', content: 'changed' });
    expect(s2.tabs.length).toBe(2);          // no duplicate tab
    expect(s2.active).toBe('/h/a.md');        // re-activated
    // the caller refetched — the tab must show the FRESH content, never the stale '# a'.
    expect(s2.tabs.find((t) => t.key === '/h/a.md').content).toBe('changed');
  });
  it('preserves existing content when re-opened WITHOUT content (image re-activate reuses its object URL)', () => {
    const s1 = openDocState(init, '/h/pic.png', { type: 'image', name: 'pic.png', content: 'blob:x' });
    const s2 = openDocState(s1, '/h/pic.png', { type: 'image', name: 'pic.png' }); // no content passed
    expect(s2.tabs.find((t) => t.key === '/h/pic.png').content).toBe('blob:x');
  });
});

describe('refreshDocState', () => {
  it('replaces a tab content in place WITHOUT changing which tab is active (no focus steal)', () => {
    let s = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: 'a' });
    s = openDocState(s, '/h/b.md', { type: 'markdown', name: 'b.md', content: 'b' }); // active b
    // a background refetch of a lands after the user switched to b — must not pull active back to a.
    const r = refreshDocState(s, '/h/a.md', { type: 'markdown', name: 'a.md', content: 'a-fresh' });
    expect(r.active).toBe('/h/b.md');
    expect(r.tabs.find((t) => t.key === '/h/a.md').content).toBe('a-fresh');
  });
  it('is a no-op when the tab was closed mid-fetch', () => {
    expect(refreshDocState(init, '/gone.md', { content: 'x' })).toBe(init);
  });
  it('preserves content when meta.content is undefined (image reuse)', () => {
    const s = openDocState(init, '/h/p.png', { type: 'image', name: 'p.png', content: 'blob:x' });
    const r = refreshDocState(s, '/h/p.png', { type: 'image', name: 'p.png' });
    expect(r.tabs.find((t) => t.key === '/h/p.png').content).toBe('blob:x');
  });
});

describe('closeTabState', () => {
  it('removes a doc tab and falls back to the left neighbour when closing the active one', () => {
    let s = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: 'a' });
    s = openDocState(s, '/h/b.md', { type: 'markdown', name: 'b.md', content: 'b' }); // active b
    s = closeTabState(s, '/h/b.md');
    expect(s.tabs.map((t) => t.key)).toEqual(['home', '/h/a.md']);
    expect(s.active).toBe('/h/a.md');
  });
  it('never closes the home tab', () => {
    const s = closeTabState(init, 'home');
    expect(s.tabs.map((t) => t.key)).toEqual(['home']);
  });
  it('keeps active unchanged when closing a non-active tab', () => {
    let s = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: 'a' });
    s = openDocState(s, '/h/b.md', { type: 'markdown', name: 'b.md', content: 'b' }); // active b
    s = closeTabState(s, '/h/a.md');
    expect(s.active).toBe('/h/b.md');
  });
  it('is a no-op when the key is not in tabs', () => {
    expect(closeTabState(init, '/nonexistent.md')).toBe(init);
  });
});

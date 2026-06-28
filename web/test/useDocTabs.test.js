import { describe, it, expect } from 'vitest';
import { HOME_TAB, openDocState, closeTabState } from '../src/hooks/useDocTabs.js';

const init = { tabs: [HOME_TAB], active: 'home' };

describe('openDocState', () => {
  it('appends a new doc tab and activates it', () => {
    const s = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: '# a' });
    expect(s.tabs.map((t) => t.key)).toEqual(['home', '/h/a.md']);
    expect(s.active).toBe('/h/a.md');
  });
  it('dedupes: opening an already-open path only activates it', () => {
    const s1 = openDocState(init, '/h/a.md', { type: 'markdown', name: 'a.md', content: '# a' });
    const s2 = openDocState({ ...s1, active: 'home' }, '/h/a.md', { type: 'markdown', name: 'a.md', content: 'changed' });
    expect(s2.tabs.length).toBe(2);          // no duplicate tab
    expect(s2.active).toBe('/h/a.md');        // just re-activated
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

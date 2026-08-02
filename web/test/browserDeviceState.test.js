import { beforeEach, describe, expect, it } from 'vitest';
import {
  readBrowserTabs,
  writeBrowserTabs,
} from '../src/browserState.js';

beforeEach(() => localStorage.clear());

describe('device-owned browser tabs', () => {
  it('persists order and canonical fields without proxy runtime bindings', () => {
    writeBrowserTabs({
      tabs: [
        {
          id: 'a', mode: 'proxy', originalUrl: 'https://a.example/', title: 'A',
          deadline: 123, createdAt: 100, url: '/bootstrap', channel: 'secret', generation: 4,
        },
        { id: 'b', mode: 'direct', originalUrl: 'https://b.example/', title: 'B', deadline: null },
      ],
      activeId: 'b',
      open: true,
      historyActive: false,
    });

    expect(readBrowserTabs()).toEqual({
      tabs: [
        { id: 'a', mode: 'proxy', originalUrl: 'https://a.example/', title: 'A', deadline: 123, createdAt: 100 },
        { id: 'b', mode: 'direct', originalUrl: 'https://b.example/', title: 'B', deadline: null },
      ],
      activeId: 'b',
      open: true,
      historyActive: false,
    });
  });

  it('drops malformed persisted tabs and repairs selection locally', () => {
    localStorage.setItem('hm_browser_tabs1', JSON.stringify({
      tabs: [{ id: 'bad', mode: 'proxy', originalUrl: 'javascript:alert(1)' }],
      activeId: 'bad', open: true, historyActive: false,
    }));
    expect(readBrowserTabs()).toEqual({
      tabs: [], activeId: null, open: false, historyActive: true,
    });
  });
});

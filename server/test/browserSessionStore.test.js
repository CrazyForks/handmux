import { describe, expect, it, vi } from 'vitest';
import { createBrowserSessionStore } from '../src/browser/sessionStore.js';

function scheduler() {
  let next = 1;
  const timers = new Map();
  return {
    timers,
    setTimer(fn, ms) {
      const id = next++;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    fire(id) {
      const timer = timers.get(id);
      timers.delete(id);
      timer?.fn();
    },
  };
}

function tab(id) {
  return { id, session: { id: `session-${id}` }, originalUrl: `https://${id}.example.com/`, title: id };
}

describe('browser session store', () => {
  it('does not schedule a close timer while a tab is visible', () => {
    const clock = scheduler();
    const store = createBrowserSessionStore({ now: () => 1_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    const added = store.add(tab('a'));

    expect(added).toMatchObject({ id: 'a', visible: true, hiddenAt: null, expiresAt: null });
    expect(clock.timers.size).toBe(0);
  });

  it('expires hidden tabs independently', () => {
    let now = 1_000;
    const clock = scheduler();
    const onExpire = vi.fn();
    const store = createBrowserSessionStore({ now: () => now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onExpire });
    store.add(tab('a'));
    store.add(tab('b'));

    store.setVisible('a', false, 10);
    now = 2_000;
    store.setVisible('b', false, 30);

    expect(store.get('a')).toMatchObject({ hiddenAt: 1_000, expiresAt: 601_000 });
    expect(store.get('b')).toMatchObject({ hiddenAt: 2_000, expiresAt: 1_802_000 });
    const [aTimer] = [...clock.timers.entries()].filter(([, timer]) => timer.ms === 600_000)[0];
    clock.fire(aTimer);
    expect(store.get('a')).toBeNull();
    expect(store.get('b')).not.toBeNull();
    expect(onExpire).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'expired');
  });

  it('cancels and resets a tab timer when the tab becomes visible again', () => {
    let now = 5_000;
    const clock = scheduler();
    const store = createBrowserSessionStore({ now: () => now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    store.add(tab('a'));
    store.setVisible('a', false, 10);
    const firstTimer = [...clock.timers.keys()][0];

    now = 20_000;
    store.setVisible('a', true, 10);
    expect(clock.timers.has(firstTimer)).toBe(false);
    expect(store.get('a')).toMatchObject({ visible: true, hiddenAt: null, expiresAt: null });

    now = 30_000;
    store.setVisible('a', false, 30);
    expect(store.get('a')).toMatchObject({ visible: false, hiddenAt: 30_000, expiresAt: 1_830_000 });
    expect([...clock.timers.values()][0].ms).toBe(1_800_000);
  });

  it('keeps a hidden tab indefinitely when closeAfterMinutes is null', () => {
    const clock = scheduler();
    const store = createBrowserSessionStore({ now: () => 1_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    store.add(tab('a'));

    store.setVisible('a', false, null);

    expect(store.get('a')).toMatchObject({ visible: false, hiddenAt: 1_000, expiresAt: null });
    expect(clock.timers.size).toBe(0);
  });

  it('clears every timer when the store closes', () => {
    const clock = scheduler();
    const onExpire = vi.fn();
    const store = createBrowserSessionStore({ now: () => 1_000, setTimer: clock.setTimer, clearTimer: clock.clearTimer, onExpire });
    store.add(tab('a'));
    store.add(tab('b'));
    store.setVisible('a', false, 10);
    store.setVisible('b', false, 30);

    const removed = store.close();

    expect(removed.map((item) => item.id)).toEqual(['a', 'b']);
    expect(store.list()).toEqual([]);
    expect(clock.timers.size).toBe(0);
    expect(onExpire).not.toHaveBeenCalled();
  });
});

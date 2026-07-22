export function createBrowserSessionStore({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onExpire = () => {},
} = {}) {
  const tabs = new Map();

  const cancel = (tab) => {
    if (tab.timer != null) clearTimer(tab.timer);
    tab.timer = null;
    tab.hiddenAt = null;
    tab.expiresAt = null;
  };

  const remove = (id) => {
    const tab = tabs.get(id);
    if (!tab) return null;
    if (tab.timer != null) clearTimer(tab.timer);
    tabs.delete(id);
    const { timer: _timer, ...out } = tab;
    return out;
  };

  const view = (tab) => {
    if (!tab) return null;
    const { timer: _timer, ...out } = tab;
    return out;
  };

  return {
    add(input) {
      if (tabs.has(input.id)) throw new Error(`browser tab already exists: ${input.id}`);
      const mode = input.mode === 'direct' ? 'direct' : 'proxy';
      const tab = { ...input, mode, visible: true, hiddenAt: null, expiresAt: null, timer: null };
      tabs.set(tab.id, tab);
      return view(tab);
    },

    get(id) { return view(tabs.get(id)); },

    list() { return [...tabs.values()].map(view); },

    update(id, patch) {
      const tab = tabs.get(id);
      if (!tab) return null;
      Object.assign(tab, patch);
      return view(tab);
    },

    setVisible(id, visible, closeAfterMinutes) {
      const tab = tabs.get(id);
      if (!tab) return null;
      cancel(tab);
      tab.visible = !!visible;
      if (!tab.visible) {
        tab.hiddenAt = now();
        if (closeAfterMinutes != null) {
          const delay = closeAfterMinutes * 60_000;
          tab.expiresAt = tab.hiddenAt + delay;
          tab.timer = setTimer(() => {
            const expired = remove(id);
            if (expired) onExpire(expired, 'expired');
          }, delay);
        }
      }
      return view(tab);
    },

    remove,

    close() {
      const removed = [];
      for (const id of [...tabs.keys()]) removed.push(remove(id));
      return removed;
    },
  };
}

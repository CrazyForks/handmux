export const BROWSER_CLOSE_AFTER_OPTIONS = [10, 30, 60, 120];
export const BROWSER_PROFILE_RETENTION_OPTIONS = [1, 7, 30, null];

const PREF_KEY = 'hm_browser_close_after1';
const PROFILE_PERSIST_KEY = 'hm_browser_profile_persist1';
const PROFILE_RETENTION_KEY = 'hm_browser_profile_retention1';
const HISTORY_KEY = 'hm_browser_history1';
const TABS_KEY = 'hm_browser_tabs1';
const HISTORY_LIMIT = 200;
const SENSITIVE_URL_FIELD = /^(?:access_token|id_token|refresh_token|token|code|authorization|api_?key)$/i;

function isCloseAfter(value) {
  return BROWSER_CLOSE_AFTER_OPTIONS.includes(value);
}

export function normalizeBrowserInput(value) {
  const input = String(value ?? '').trim();
  if (!input) return null;

  let candidate = input;
  if (/^\d+$/.test(input)) {
    const port = Number(input);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    candidate = `http://127.0.0.1:${port}/`;
  } else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(input)) {
    candidate = `https://${input}`;
  }

  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function readBrowserPrefs() {
  const raw = localStorage.getItem(PREF_KEY);
  const persistProxyLogin = localStorage.getItem(PROFILE_PERSIST_KEY) === '1';
  const retentionRaw = localStorage.getItem(PROFILE_RETENTION_KEY);
  const parsedRetention = retentionRaw === 'never' ? null : Number(retentionRaw);
  const proxyLoginRetentionDays = BROWSER_PROFILE_RETENTION_OPTIONS.includes(parsedRetention)
    ? parsedRetention : 30;
  const profile = { persistProxyLogin, proxyLoginRetentionDays };
  const value = Number(raw);
  return {
    closeAfter: isCloseAfter(value) ? value : 10, ...profile,
  };
}

export function setBrowserCloseAfter(value) {
  if (!isCloseAfter(value)) {
    localStorage.removeItem(PREF_KEY);
    return;
  }
  localStorage.setItem(PREF_KEY, String(value));
}

export function setPersistProxyLogin(value) {
  if (value === true) localStorage.setItem(PROFILE_PERSIST_KEY, '1');
  else localStorage.removeItem(PROFILE_PERSIST_KEY);
}

export function setProxyLoginRetentionDays(value) {
  if (!BROWSER_PROFILE_RETENTION_OPTIONS.includes(value)) {
    localStorage.removeItem(PROFILE_RETENTION_KEY);
    return;
  }
  localStorage.setItem(PROFILE_RETENTION_KEY, value === null ? 'never' : String(value));
}

function sanitizedHistoryEntry(entry) {
  try {
    const url = new URL(String(entry?.url || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_FIELD.test(key)) url.searchParams.delete(key);
    }
    if (/(?:^|[&#])(?:access_token|id_token|refresh_token|token|code|authorization|api_?key)=/i.test(url.hash)) {
      url.hash = '';
    }
    const lastMode = entry?.lastMode === 'proxy'
      ? 'proxy'
      : entry?.lastMode === 'direct' ? 'direct' : null;
    return {
      url: url.toString(),
      title: String(entry?.title || ''),
      visitedAt: Number.isFinite(Number(entry?.visitedAt)) ? Number(entry.visitedAt) : Date.now(),
      ...(lastMode ? { lastMode } : {}),
    };
  } catch {
    return null;
  }
}

export function readBrowserHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(value)) return [];
    return value.map(sanitizedHistoryEntry).filter(Boolean).slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function addBrowserHistory(entry) {
  const clean = sanitizedHistoryEntry(entry);
  if (!clean) return;
  localStorage.setItem(HISTORY_KEY, JSON.stringify([clean, ...readBrowserHistory()].slice(0, HISTORY_LIMIT)));
}

export function upsertBrowserHistory(entry) {
  const clean = sanitizedHistoryEntry(entry);
  if (!clean) return;
  const remaining = readBrowserHistory().filter((item) => item.url !== clean.url);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([clean, ...remaining].slice(0, HISTORY_LIMIT)));
}

export function deleteBrowserHistoryEntry(entry) {
  const target = sanitizedHistoryEntry(entry);
  if (!target) return;
  const remaining = readBrowserHistory().filter((item) => (
    item.url !== target.url || item.visitedAt !== target.visitedAt
  ));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(remaining));
}

export function clearBrowserHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

function persistedTab(tab) {
  const originalUrl = normalizeBrowserInput(tab?.originalUrl);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(String(tab?.id || '')) || !originalUrl) return null;
  return {
    id: String(tab.id),
    mode: tab.mode === 'proxy' ? 'proxy' : 'direct',
    originalUrl,
    title: String(tab.title || '').slice(0, 1024),
    deadline: Number.isFinite(tab.deadline) ? tab.deadline : null,
  };
}

export function readBrowserTabs() {
  try {
    const raw = JSON.parse(localStorage.getItem(TABS_KEY) || '{}');
    const tabs = Array.isArray(raw.tabs) ? raw.tabs.map(persistedTab).filter(Boolean) : [];
    const activeId = tabs.some((tab) => tab.id === raw.activeId) ? raw.activeId : null;
    const historyActive = activeId ? !!raw.historyActive : true;
    return {
      tabs,
      activeId,
      open: !!raw.open && (!!activeId || raw.historyActive === true),
      historyActive,
    };
  } catch {
    return { tabs: [], activeId: null, open: false, historyActive: true };
  }
}

export function writeBrowserTabs({ tabs, activeId, open, historyActive }) {
  const persisted = (tabs || []).map(persistedTab).filter(Boolean);
  const selected = persisted.some((tab) => tab.id === activeId) ? activeId : null;
  localStorage.setItem(TABS_KEY, JSON.stringify({
    tabs: persisted,
    activeId: selected,
    open: !!open,
    historyActive: selected ? !!historyActive : true,
  }));
}

export function clearBrowserTabs() {
  localStorage.removeItem(TABS_KEY);
}

export function browserEntryStatus(tabs) {
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  return tabs.some((tab) => tab?.mode === 'proxy') ? 'proxy' : 'direct';
}

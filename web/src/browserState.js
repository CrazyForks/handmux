export const BROWSER_CLOSE_AFTER_OPTIONS = [10, 30, 60, 120, null];

const PREF_KEY = 'hm_browser_close_after1';
const DEFAULT_MODE_KEY = 'hm_browser_default_mode1';
const HISTORY_KEY = 'hm_browser_history1';
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
  const defaultMode = localStorage.getItem(DEFAULT_MODE_KEY) === 'proxy' ? 'proxy' : 'direct';
  if (raw === 'never') return { closeAfter: null, defaultMode };
  const value = Number(raw);
  return { closeAfter: isCloseAfter(value) && value != null ? value : 10, defaultMode };
}

export function setBrowserCloseAfter(value) {
  if (!isCloseAfter(value)) {
    localStorage.removeItem(PREF_KEY);
    return;
  }
  localStorage.setItem(PREF_KEY, value == null ? 'never' : String(value));
}

export function setBrowserDefaultMode(mode) {
  if (mode !== 'direct' && mode !== 'proxy') {
    localStorage.removeItem(DEFAULT_MODE_KEY);
    return;
  }
  localStorage.setItem(DEFAULT_MODE_KEY, mode);
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

export function clearBrowserHistory() {
  localStorage.removeItem(HISTORY_KEY);
}

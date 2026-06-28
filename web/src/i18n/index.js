// Lightweight i18n. Default English; auto-detect the browser language; manual override persisted in
// localStorage. Adding a language = create ./<code>.js with the same keys, import it, and add it to the
// two maps below — nothing else changes, and any missing key falls back to English.
import en from './en.js';
import zh from './zh.js';

const LOCALES = { en, zh };
export const AVAILABLE = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
];

const LANG_KEY = 'tw_lang';

// pure + testable: saved override wins, else first browser language we have a locale for, else English.
export function detectLang(saved, languages, available = LOCALES) {
  if (saved && available[saved]) return saved;
  for (const l of (languages && languages.length ? languages : ['en'])) {
    const code = String(l).toLowerCase().split('-')[0];
    if (available[code]) return code;
  }
  return 'en';
}

// pure + testable: current-dict → English-fallback → key, then {var} interpolation.
export function translate(dict, fallback, key, vars) {
  let s = dict && dict[key] != null ? dict[key]
        : fallback && fallback[key] != null ? fallback[key]
        : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
  return s;
}

const navLangs = () => (typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : null);
const saved = () => { try { return localStorage.getItem(LANG_KEY); } catch { return null; } };

let current = detectLang(saved(), navLangs());

export function t(key, vars) { return translate(LOCALES[current], en, key, vars); }
export function getLangCode() { return current; }

export function setLang(code) {
  if (!LOCALES[code] || code === current) return;
  try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode: in-memory only */ }
  current = code;
  // The terminal is rebuilt from a fresh capture on load, so a reload is cheap and avoids threading
  // i18n reactivity through every component just to retranslate static labels.
  if (typeof location !== 'undefined') location.reload();
}

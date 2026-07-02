// CLI-side i18n. Mirrors the web i18n shape (a pure `translate` with English fallback) but resolves the
// locale from the shell environment / flags / config instead of the browser + localStorage. Default is
// English; a Chinese shell (LANG/LC_* = zh…) or an explicit `--lang zh` / config `"lang": "zh"` switches it.
// Adding a language = create ./<code>.js with the same keys, import it, and add it to LOCALES — any missing
// key falls back to English, so a partial translation degrades gracefully rather than printing blanks.
import en from './en.js';
import zh from './zh.js';

const LOCALES = { en, zh };
export const AVAILABLE = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
];

// pure + testable: current-dict → English-fallback → key, then {var} interpolation (same as web).
export function translate(dict, fallback, key, vars) {
  let s = dict && dict[key] != null ? dict[key]
        : fallback && fallback[key] != null ? fallback[key]
        : key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : `{${k}}`));
  return s;
}

// A POSIX locale string → the base language we might have a dict for: `zh_CN.UTF-8` → `zh`, `en` → `en`.
const baseOf = (v) => String(v || '').toLowerCase().split(/[._@-]/)[0];

// pure + testable: explicit choice (flag/config) wins, else the first shell locale var that names a known
// language, else English. `C`/`POSIX`/`C.UTF-8` carry no language → fall through to English.
export function detectLang(flags = {}, fileCfg = {}, env = {}, available = LOCALES) {
  const explicit = flags.lang ?? fileCfg.lang;
  if (explicit != null) { const b = baseOf(explicit); if (available[b]) return b; }
  for (const k of ['HANDMUX_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const b = baseOf(env[k]);
    if (b && available[b]) return b;
  }
  return 'en';
}

let current = 'en';

// Resolve + install the active locale for the whole CLI process (called once at startup). Returns the code.
export function initLocale(flags, fileCfg, env = process.env) {
  current = detectLang(flags, fileCfg, env);
  return current;
}

// Force a specific locale (e.g. right after the setup wizard's language question, so the rest of the wizard
// speaks the chosen language). No-op for an unknown code.
export function setLocale(code) { if (LOCALES[code]) current = code; }
export function getLocale() { return current; }

// The one call sites use: translate `key` in the active locale, falling back to English then the key itself.
export function t(key, vars) { return translate(LOCALES[current], en, key, vars); }

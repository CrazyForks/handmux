import { useState, useEffect } from 'react';
import { getConfig } from '../api.js';

// Is a server-side ASR engine (iFlytek) configured? Open-source installs ship without keys, so the mic
// must HIDE rather than show a button that can only 503. Cached in localStorage so a returning configured
// install renders the mic instantly (no flash); refreshed from /api/config on mount. Unknown (null) is
// treated as unavailable by callers — hidden until confirmed — so a fresh keyless install never flashes
// a dead mic. A transient fetch failure keeps the cached value rather than yanking the mic.
const KEY = 'tw_asr';

function cached() {
  try { const v = localStorage.getItem(KEY); return v == null ? null : v === '1'; } catch { return null; }
}

export function useAsrAvailable() {
  const [available, setAvailable] = useState(cached);
  useEffect(() => {
    let alive = true;
    Promise.resolve().then(getConfig).then((c) => {
      if (!alive) return;
      const ok = !!c?.asr;
      setAvailable(ok);
      try { localStorage.setItem(KEY, ok ? '1' : '0'); } catch { /* no localStorage in this env */ }
    }).catch(() => { /* keep cached/unknown on a transient failure */ });
    return () => { alive = false; };
  }, []);
  return available;
}

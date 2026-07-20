import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getConfig } from '../api.js';
import { DEFAULT_SERVER_SHORTCUTS } from '../shortcutMerge.js';

function validShortcuts(value) {
  return value && Array.isArray(value.command) && Array.isArray(value.chat);
}

// Load the app-wide config after authentication and whenever the app returns to the foreground.
// Consumers share this snapshot; there is no timer-based polling.
export function useServerConfig({ enabled = true } = {}) {
  const [config, setConfig] = useState(null);
  const requested = useRef(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const enabledRef = useRef(enabled);
  const enabledEpoch = useRef(0);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Update this before passive-effect cleanup so a stale visibility listener cannot cross auth cycles.
  useLayoutEffect(() => {
    if (enabledRef.current === enabled) return;
    enabledRef.current = enabled;
    enabledEpoch.current += 1;
  }, [enabled]);

  const refresh = useCallback(() => {
    if (!mounted.current || !enabledRef.current || inFlight.current) return;
    inFlight.current = true;
    const epoch = enabledEpoch.current;
    let request;
    try { request = getConfig(); } catch { inFlight.current = false; return; }
    Promise.resolve(request).then((cfg) => {
      if (
        !mounted.current || !enabledRef.current || enabledEpoch.current !== epoch
        || !cfg || typeof cfg !== 'object'
      ) return;
      setConfig({
        ...cfg,
        shortcuts: validShortcuts(cfg.shortcuts) ? cfg.shortcuts : DEFAULT_SERVER_SHORTCUTS,
      });
    }).catch(() => {}).finally(() => { inFlight.current = false; });
  }, []);

  useEffect(() => {
    if (!enabled || requested.current) return;
    requested.current = true;
    refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onVisibility = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled, refresh]);

  return config;
}

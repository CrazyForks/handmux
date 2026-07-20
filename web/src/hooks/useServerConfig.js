import { useEffect, useRef, useState } from 'react';
import { getConfig } from '../api.js';
import { DEFAULT_SERVER_SHORTCUTS } from '../shortcutMerge.js';

function validShortcuts(value) {
  return value && Array.isArray(value.command) && Array.isArray(value.chat);
}

// Load the app-wide config once after authentication. Consumers share this snapshot;
// configuration changes take effect after the app is reopened or the page is refreshed.
export function useServerConfig({ enabled = true } = {}) {
  const [config, setConfig] = useState(null);
  const requested = useRef(false);

  useEffect(() => {
    if (!enabled || requested.current) return undefined;
    requested.current = true;
    let cancelled = false;
    getConfig().then((cfg) => {
      if (cancelled || !cfg || typeof cfg !== 'object') return;
      setConfig({
        ...cfg,
        shortcuts: validShortcuts(cfg.shortcuts) ? cfg.shortcuts : DEFAULT_SERVER_SHORTCUTS,
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [enabled]);

  return config;
}

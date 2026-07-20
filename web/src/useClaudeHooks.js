import { useState, useEffect, useCallback } from 'react';
import { installClaudeHooks } from './api.js';

// The inbox needs to tell three situations apart: hooks installed (normal empty state), Claude Code present
// but hooks not installed (offer to enable), and no Claude Code at all (don't nag). The server reports this
// on /api/config as `claudeHooks`; older servers omit it → treat as 'installed' (back-compat, never nag).
// Cached in localStorage so a returning install renders without a flash; the App's startup config updates it.
const KEY = 'tw_claude_hooks';

function cached() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function useClaudeHooks(config = null) {
  const [status, setStatus] = useState(cached); // 'installed' | 'absent' | 'no-claude' | null
  useEffect(() => {
    if (!config) return;
    const s = config.claudeHooks || 'installed'; // field absent on old servers → don't nag
    setStatus(s);
    try { localStorage.setItem(KEY, s); } catch { /* no localStorage in this env */ }
  }, [config]);

  const enable = useCallback(async () => {
    const r = await installClaudeHooks();
    if (r?.status) {
      setStatus(r.status);
      try { localStorage.setItem(KEY, r.status); } catch { /* ignore */ }
    }
    return r;
  }, []);

  return { status, enable };
}

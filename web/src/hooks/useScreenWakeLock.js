import { useEffect } from 'react';

// Keep the screen awake while `active` is true (e.g. during voice capture) so the phone doesn't dim
// or lock mid-dictation. Uses the Screen Wake Lock API (iOS Safari 16.4+, Chrome/Android); a no-op
// where unsupported. The OS auto-releases the lock when the page is hidden, so we re-acquire on
// visibilitychange whenever we come back to the foreground and are still active.
export function useScreenWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let sentinel = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request('screen');
        if (cancelled) { try { s.release(); } catch { /* ignore */ } return; }
        sentinel = s;
      } catch { /* denied / battery saver / lost gesture — let the screen behave normally */ }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !cancelled) acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      try { sentinel && sentinel.release(); } catch { /* ignore */ }
      sentinel = null;
    };
  }, [active]);
}

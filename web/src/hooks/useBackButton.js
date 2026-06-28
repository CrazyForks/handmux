import { useEffect, useRef } from 'react';

// While `active`, make the hardware/browser Back button close the overlay instead of leaving the
// page (on mobile, Back would otherwise exit the app). We push ONE history entry when `active` turns
// on; pressing Back pops it and fires popstate → onClose. If the overlay is dismissed by other means
// (a ▾/close button), we consume that pushed entry on cleanup so history stays balanced — otherwise
// the next Back would just silently undo our phantom entry.
//
// onClose is held in a ref so an unstable inline callback doesn't re-run the effect (which would
// pile up history entries); the effect depends only on `active`.
export function useBackButton(active, onClose) {
  const cbRef = useRef(onClose);
  cbRef.current = onClose;
  useEffect(() => {
    if (!active) return undefined;
    window.history.pushState({ overlay: true }, '');
    const onPop = () => cbRef.current?.();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Still on top → closed by a button, not Back: pop our own entry. After a real Back the entry
      // is already gone (state no longer ours), so we leave history alone.
      if (window.history.state?.overlay) window.history.back();
    };
  }, [active]);
}

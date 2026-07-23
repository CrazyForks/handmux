import { useEffect, useRef } from 'react';

// Mirror Browser's two UI levels into window.history:
// History (root) → page (drill). The popstate handler only consumes entries;
// it never pushes from inside popstate, which keeps Android WebViews balanced.
export function useBrowserBackStack({
  open,
  historyActive,
  switchTab,
  setOpen,
}) {
  const depthRef = useRef(0);
  const previousHistoryActiveRef = useRef(historyActive);
  const suppressNextPopRef = useRef(false);
  const switchTabRef = useRef(switchTab);
  const setOpenRef = useRef(setOpen);
  switchTabRef.current = switchTab;
  setOpenRef.current = setOpen;

  useEffect(() => {
    if (!open) {
      previousHistoryActiveRef.current = historyActive;
      return undefined;
    }
    window.history.pushState({ overlay: true }, '');
    depthRef.current = 1;
    previousHistoryActiveRef.current = historyActive;
    const onPop = () => {
      const previousDepth = depthRef.current;
      depthRef.current = Math.max(0, previousDepth - 1);
      if (suppressNextPopRef.current) {
        suppressNextPopRef.current = false;
        return;
      }
      if (previousDepth > 1) {
        void switchTabRef.current?.('history');
      } else {
        void setOpenRef.current?.(false);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (depthRef.current > 0) window.history.go(-depthRef.current);
      depthRef.current = 0;
      suppressNextPopRef.current = false;
    };
  }, [open]); // callbacks and current level are read through refs

  useEffect(() => {
    if (!open) {
      previousHistoryActiveRef.current = historyActive;
      return;
    }
    const previous = previousHistoryActiveRef.current;
    previousHistoryActiveRef.current = historyActive;
    if (previous && !historyActive) {
      window.history.pushState({ overlay: true }, '');
      depthRef.current += 1;
    } else if (!previous && historyActive && depthRef.current > 1) {
      suppressNextPopRef.current = true;
      window.history.back();
    }
  }, [historyActive, open]);
}

import { useEffect, useState } from 'react';

// True while the on-screen keyboard is up. Reads the visual-viewport HEIGHT only
// (innerHeight − vv.height) — offsetTop-immune, unlike the layout inset, which iOS cancels to ~0
// mid-focus (see useKeyboardInset's caveat and BottomDock's reconcile). The >120px threshold filters
// Safari's toolbar chrome. Safe false when visualViewport is unsupported (jsdom, old browsers).
export function softKeyboardUp() {
  const vv = window.visualViewport;
  if (!vv) return false;
  return window.innerHeight - vv.height > 120;
}

// Pixels the on-screen keyboard overlaps the layout viewport's bottom. iOS Safari shrinks the
// visual viewport (not the layout viewport) when the keyboard opens, leaving bottom-docked UI
// hidden behind it; we read that overlap so the caller can shrink the app to the visible area
// (height: calc(100% - inset)), lifting the whole column above the keyboard.
// Returns 0 when there's no keyboard or when visualViewport is unsupported (safe fallback).
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      const overlap = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(overlap)));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

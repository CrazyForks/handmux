import { useEffect, useRef, useState } from 'react';

// True while the on-screen keyboard is up. `fullHeight` is the last keyboard-down viewport height:
// some mobile browsers shrink window.innerHeight together with visualViewport.height, so comparing only
// those two CURRENT values can incorrectly produce zero. offsetTop stays deliberately excluded because
// iOS focus scrolling changes it while the keyboard remains open.
export function softKeyboardUp(fullHeight = window.innerHeight) {
  const vv = window.visualViewport;
  if (!vv) return false;
  return Math.max(fullHeight, window.innerHeight) - vv.height > 120;
}

// Pixels the on-screen keyboard overlaps the layout viewport's bottom. iOS Safari shrinks the
// visual viewport (not the layout viewport) when the keyboard opens, leaving bottom-docked UI
// hidden behind it; we read that overlap so the caller can shrink the app to the visible area
// (height: calc(100% - inset)), lifting the whole column above the keyboard.
// Returns 0 when there's no keyboard or when visualViewport is unsupported (safe fallback).
export function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  const viewportRef = useRef(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    viewportRef.current = {
      width: vv.width,
      fullHeight: Math.max(window.innerHeight, vv.height),
    };
    const update = () => {
      const viewport = viewportRef.current;
      if (Math.abs(vv.width - viewport.width) > 40) {
        viewport.width = vv.width;
        viewport.fullHeight = Math.max(window.innerHeight, vv.height);
      } else {
        viewport.fullHeight = Math.max(viewport.fullHeight, window.innerHeight, vv.height);
      }
      // offsetTop is focus scrolling, not keyboard height. On iOS it can churn or remain displaced after
      // repeated focus/blur cycles; subtracting it made the second keyboard close leave a stale app lift.
      const keyboardHeight = viewport.fullHeight - vv.height;
      setInset(keyboardHeight > 120 ? Math.round(keyboardHeight) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      viewportRef.current = null;
    };
  }, []);
  return inset;
}

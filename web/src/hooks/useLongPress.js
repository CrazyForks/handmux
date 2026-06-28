import { useRef } from 'react';

// Detect a long-press without breaking a normal tap. Pointer events ONLY (never touch+mouse
// together — see the KeyBar/Dock note in CLAUDE.md): one pointer stream = one gesture. A press
// held past HOLD_MS fires onLongPress and suppresses the click that the browser emits afterward;
// a short tap falls through to onClick; a finger move past MOVE_PX cancels the press (the window
// bar scrolls horizontally, so a swipe is a scroll, not a long-press).
//
// Wire BOTH onClick (the normal tap action) and the pointer handlers: a raw click with no
// preceding long-press still selects, so a plain click event (e.g. in tests, or assistive tech)
// keeps working.
const HOLD_MS = 500;
const MOVE_PX = 10;

export function useLongPress(onLongPress, { onClick } = {}) {
  const timer = useRef(null);
  const start = useRef(null); // pointer-down position
  const fired = useRef(false); // a long-press fired → swallow the next click

  const clear = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  };

  return {
    onPointerDown: (e) => {
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress?.();
      }, HOLD_MS);
    },
    onPointerMove: (e) => {
      if (!timer.current || !start.current) return;
      if (Math.abs(e.clientX - start.current.x) > MOVE_PX ||
          Math.abs(e.clientY - start.current.y) > MOVE_PX) {
        clear();
      }
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClick: (e) => {
      if (fired.current) { // the click that follows a fired long-press — eat it
        fired.current = false;
        e.preventDefault?.();
        e.stopPropagation?.();
        return;
      }
      onClick?.(e);
    },
  };
}

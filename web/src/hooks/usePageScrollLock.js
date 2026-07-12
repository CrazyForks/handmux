import { useEffect } from 'react';

// Lock the PAGE against native touch scrolling/panning, everywhere except elements genuinely meant to
// scroll — and, for a horizontal-only scroller (the key strip), only along its own axis. This kills two
// linked bugs that both trace to the same cause: with the soft keyboard up, the browser natively scrolls
// the whole page to keep the focused input visible, and that scroll is draggable, so:
//   • dragging the dock pans the entire app up/down under your finger (measured appΔ==dockΔ, keyboard
//     itself never moves → it's a page scroll, not our transform);
//   • on iOS that scroll pushes visualViewport.offsetTop up until `innerHeight - vv.height - vv.offsetTop`
//     cancels to 0 — which is exactly why useKeyboardInset read 0 and our translateY(-inset) lift silently
//     no-oped on iOS. Locking the scroll keeps offsetTop at 0, so the inset measures right and the lift
//     works again.
//
// Per touch we look at where the finger landed:
//   canScrollY (terminal viewport, sheet bodies) → leave it fully to native.
//   canScrollX only (the horizontal key strip) → allow horizontal moves, block vertical (the page-pan leak
//     from key buttons, whose touch-action:manipulation would otherwise let a vertical drag pan the page).
//   neither (dock handle, composer, gaps) → block every direction.
function scrollableAxes(el) {
  let x = false, y = false;
  for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (!y && (s.overflowY === 'auto' || s.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) y = true;
    if (!x && (s.overflowX === 'auto' || s.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) x = true;
    if (x && y) break;
  }
  return { x, y };
}

export function usePageScrollLock() {
  useEffect(() => {
    let mode = 'block'; // 'free' (owner scrolls both) | 'xonly' (horizontal scroller) | 'block'
    let sx = 0, sy = 0;
    const onStart = (e) => {
      const t = e.touches[0];
      sx = t ? t.clientX : 0;
      sy = t ? t.clientY : 0;
      if (!(e.target instanceof Element)) { mode = 'block'; return; }
      const { x, y } = scrollableAxes(e.target);
      mode = y ? 'free' : x ? 'xonly' : 'block';
    };
    const onMove = (e) => {
      if (mode === 'free' || !e.cancelable) return;
      if (mode === 'xonly') {
        const t = e.touches[0];
        if (t && Math.abs(t.clientX - sx) >= Math.abs(t.clientY - sy)) return; // horizontal → its own axis
      }
      e.preventDefault(); // block the page pan (vertical on the strip, everything on a non-scroller)
    };
    document.addEventListener('touchstart', onStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onMove, { passive: false, capture: true });
    return () => {
      document.removeEventListener('touchstart', onStart, { capture: true });
      document.removeEventListener('touchmove', onMove, { capture: true });
    };
  }, []);
}

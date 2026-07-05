import { useEffect, useState } from 'react';

// TEMPORARY on-screen event HUD for real-device debugging (the 0ffa95d technique). Mount by opening
// the app with `#hud` in the URL. Logs, capture-phase at document level: pointer down/up/cancel
// (with hit target + coords), focus moves, textarea blur, and visualViewport height changes (= the
// soft keyboard opening/closing). Draws as a fixed overlay that never intercepts touches.
// Remove once the composer caret-drag/keyboard-collapse mystery is solved.
const MAX = 16;
const label = (el) => {
  if (!el || !el.tagName) return String(el);
  const cls = typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : '';
  return `${el.tagName.toLowerCase()}${cls}`;
};
export default function EventHud() {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const t0 = performance.now();
    const log = (msg) => setLines((ls) => [...ls.slice(-(MAX - 1)), `${((performance.now() - t0) / 1000).toFixed(1)} ${msg}`]);
    const onPtr = (e) => log(`${e.type.slice(7)} ${label(e.target)} ${Math.round(e.clientX)},${Math.round(e.clientY)}`);
    const onFocus = (e) => log(`focusin ${label(e.target)}`);
    const onBlur = (e) => log(`focusout ${label(e.target)} → ${label(e.relatedTarget) || 'null'}`);
    const onSel = () => {
      const el = document.activeElement;
      if (el?.tagName === 'TEXTAREA') log(`sel ${el.selectionStart}-${el.selectionEnd}`);
    };
    const vv = window.visualViewport;
    const onVv = () => log(`vv h=${Math.round(vv.height)}`);
    document.addEventListener('pointerdown', onPtr, true);
    document.addEventListener('pointerup', onPtr, true);
    document.addEventListener('pointercancel', onPtr, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onBlur, true);
    document.addEventListener('selectionchange', onSel);
    vv?.addEventListener('resize', onVv);
    return () => {
      document.removeEventListener('pointerdown', onPtr, true);
      document.removeEventListener('pointerup', onPtr, true);
      document.removeEventListener('pointercancel', onPtr, true);
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onBlur, true);
      document.removeEventListener('selectionchange', onSel);
      vv?.removeEventListener('resize', onVv);
    };
  }, []);
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, pointerEvents: 'none',
      background: 'rgba(0,0,0,.72)', color: '#7CFC9A', font: '10px/1.35 ui-monospace, Menlo, monospace',
      padding: '2px 4px', whiteSpace: 'pre', overflow: 'hidden',
    }}>
      {lines.join('\n')}
    </div>
  );
}

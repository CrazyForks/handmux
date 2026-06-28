import { useRef } from 'react';
import { SCROLL_COLS, KEY_LABELS, REPEAT_KEYS, keyAction } from '../keybarKeys.js';
import { createRepeater } from '../repeat.js';

// Control pad above the input box: a horizontal strip of two-key columns that scroll left↔right
// together (arrow cluster + common/less-common keys). Named keys go out via onKey (→ /keys),
// literal characters via onText (→ /send, no Enter). Arrows auto-repeat while held. ⌫ and Enter
// are not here — they live on the dock's right rail (see BottomDock).
export default function KeyBar({ onKey, onText }) {
  const dispatch = (id) => {
    const a = keyAction(id);
    if (!a) return;
    if (a.kind === 'key') onKey(a.name);
    else onText(a.ch);
  };

  return (
    <div className="keybar">
      <div className="keybar-scroll">
        {SCROLL_COLS.map((col) => <Col key={col.join()} col={col} dispatch={dispatch} />)}
      </div>
    </div>
  );
}

function Col({ col, dispatch }) {
  return (
    <div className="keybar-col">
      {col.map((id) => <Key key={id} id={id} dispatch={dispatch} />)}
    </div>
  );
}

function Key({ id, dispatch }) {
  const repRef = useRef(null);
  // The repeater is created once but its callback must always call the LATEST dispatch: dispatch
  // closes over onKey, which App rebuilds with the new pane id on every pane switch. Without this
  // ref the repeater would keep firing the stale closure, sending arrows to the old (first) pane.
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const label = KEY_LABELS[id];

  if (!REPEAT_KEYS.has(id)) {
    return (
      <button type="button" className="keybar-key" data-key={id}
        onClick={() => dispatch(id)}>{label}</button>
    );
  }

  // Held arrow: repeat. Pointer events ONLY (not touch + mouse): a tap produces exactly one
  // pointerdown, so we never double-fire. Mixing touch and mouse used to fire a second press
  // from the browser's compatibility mouse events — dispatched at the touch-END position, so a
  // slight drift made ◀/▶ also trigger the neighbouring ▲/▼ and the key felt pressed twice.
  // Touch implicitly captures the pointer to this key, so dragging off it can't hit a neighbour;
  // a release fires pointerup, a scroll/gesture takeover fires pointercancel — both stop here.
  const start = (e) => {
    if (e.cancelable) e.preventDefault();
    if (!repRef.current) repRef.current = createRepeater(() => dispatchRef.current(id));
    repRef.current.start();
  };
  const stop = () => repRef.current?.stop();
  return (
    <button type="button" className="keybar-key" data-key={id}
      onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onPointerLeave={stop}>{label}</button>
  );
}

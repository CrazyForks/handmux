import { useEffect, useRef, useState } from 'react';
import {
  CORE_COLS, CONTEXT_PAGES, KEY_LABELS, REPEAT_KEYS, keyAction,
  CTRL_OFF, CTRL_LOCKED, CTRL_ARMED, tapCtrl, ctrlActive, consumeCtrl, withCtrl,
} from '../keybarKeys.js';
import { createRepeater } from '../repeat.js';

// Control pad above the input box. Two zones:
//   • a FIXED core — inverted-T arrows (Esc/Tab in the corners) + the Ctrl modifier — that never
//     scrolls, so its keys stay under the same thumb.
//   • a PAGED extended zone — one key set per `context` ('agent' | 'shell'), swiped page-by-page
//     (snap paging, never free scroll). Named keys go out via onKey (→ /keys), literals via onText
//     (→ /send, no Enter). Arrows auto-repeat while held. ⌫ and Enter live on the dock's right rail.
// Ctrl is a sticky modifier (tap = arm one key, double-tap = lock): while active it composes the next
// key into C-<x> (see withCtrl) and then resets. ⌫ and Enter are not here — see BottomDock.
export default function KeyBar({ onKey, onText, context = 'agent' }) {
  const [ctrl, setCtrl] = useState(CTRL_OFF);
  const ctrlRef = useRef(ctrl);
  ctrlRef.current = ctrl;

  const dispatch = (id) => {
    const a = keyAction(id);
    if (!a) return;
    const active = ctrlActive(ctrlRef.current);
    const act = active ? withCtrl(a) : a;
    if (act.kind === 'key') onKey(act.name);
    else onText(act.ch);
    if (active) setCtrl(consumeCtrl); // one-shot Ctrl collapses after the key it composed
  };

  const pages = CONTEXT_PAGES[context] || CONTEXT_PAGES.agent;

  return (
    <div className="keybar">
      <div className="keybar-core">
        {CORE_COLS.map((col) => <Col key={col.join()} col={col} dispatch={dispatch} />)}
        <CtrlKey state={ctrl} setState={setCtrl} />
      </div>
      <PagedKeys pages={pages} dispatch={dispatch} />
    </div>
  );
}

// The Ctrl modifier key: single tap advances off→armed→locked→off; a fast double-tap (<400ms) jumps
// straight to locked. Pointer events only (matches the arrow/⌫ pattern — no touch+mouse double-fire).
function CtrlKey({ state, setState }) {
  const lastRef = useRef(-Infinity); // timeStamp of the previous tap; -Infinity ⇒ no prior tap
  const down = (e) => {
    if (e.cancelable) e.preventDefault();
    const now = e.timeStamp;
    if (now - lastRef.current < 400) { lastRef.current = 0; setState(CTRL_LOCKED); }
    else { lastRef.current = now; setState(tapCtrl); }
  };
  const cls = state === CTRL_LOCKED ? ' locked' : state === CTRL_ARMED ? ' armed' : '';
  return (
    <button type="button" className={`keybar-key keybar-ctrl${cls}`} data-key="ctrl" data-state={state}
      aria-pressed={state !== CTRL_OFF} aria-label="Ctrl"
      onPointerDown={down}>Ctrl</button>
  );
}

// The paged extended zone: each page is a full-width snap target; a swipe flips one page. A row of
// dots below tracks the current page. Paging is CSS scroll-snap (mandatory) so it can only ever rest
// on a whole page — the "at most left/right page flip, no free scroll" the user asked for.
function PagedKeys({ pages, dispatch }) {
  const [page, setPage] = useState(0);
  const ref = useRef(null);
  // A new context swaps the whole page set — jump back to page 0 so you don't land on a stale page.
  useEffect(() => {
    setPage(0);
    if (ref.current) ref.current.scrollLeft = 0;
  }, [pages]);
  const onScroll = () => {
    const el = ref.current;
    if (!el || !el.clientWidth) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    setPage((cur) => (p !== cur ? p : cur));
  };
  return (
    <div className="keybar-pages-wrap">
      <div className="keybar-pages" ref={ref} onScroll={onScroll}>
        {pages.map((cols, i) => (
          <div className="keybar-page" key={i}>
            {cols.map((col) => <Col key={col.join()} col={col} dispatch={dispatch} />)}
          </div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="keybar-dots" aria-hidden="true">
          {pages.map((_, i) => <i key={i} className={`keybar-dot${i === page ? ' on' : ''}`} />)}
        </div>
      )}
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

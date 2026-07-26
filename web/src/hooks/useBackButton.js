import { useEffect, useRef } from 'react';
import { useEscapeLayer } from './useEscapeLayer.js';

let nextOverlayId = 1;
const backLayers = [];
let popListenerInstalled = false;

// One Back/popstate must close only the visually topmost history-backed layer. Individual popstate
// listeners broadcast the same event to every open modal, which made nested sheets collapse together.
const onPopState = (event) => {
  const top = backLayers[backLayers.length - 1];
  if (!top) return;
  event.stopImmediatePropagation?.();
  top.callback.current?.();
};

const ensurePopListener = () => {
  if (popListenerInstalled) return;
  window.addEventListener('popstate', onPopState, true);
  popListenerInstalled = true;
};

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
  const layerRef = useRef(null);
  cbRef.current = onClose;
  if (!layerRef.current) layerRef.current = { id: nextOverlayId++, callback: cbRef };
  // Route Escape through browser Back as well. That keeps the history entry balanced and makes
  // keyboard and mobile hardware Back follow the exact same close path.
  useEscapeLayer(active, () => window.history.back());
  useEffect(() => {
    if (!active) return undefined;
    const layer = layerRef.current;
    ensurePopListener();
    backLayers.push(layer);
    window.history.pushState({ overlay: true, overlayId: layer.id }, '');
    return () => {
      const index = backLayers.lastIndexOf(layer);
      if (index >= 0) backLayers.splice(index, 1);
      // Still on top → closed by a button, not Back: pop our own entry. After a real Back the entry
      // is already gone (state no longer ours), so we leave history alone.
      if (window.history.state?.overlayId === layer.id) window.history.back();
    };
  }, [active]);
}

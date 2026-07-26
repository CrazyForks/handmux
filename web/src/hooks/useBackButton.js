import { useEffect, useRef } from 'react';
import { useEscapeLayer } from './useEscapeLayer.js';

let nextOverlayId = 1;
const backLayers = [];
let popListenerInstalled = false;
let ignoredPops = 0;

// One Back/popstate must close only the visually topmost history-backed layer. Individual popstate
// listeners broadcast the same event to every open modal, which made nested sheets collapse together.
const onPopState = () => {
  if (ignoredPops > 0) {
    ignoredPops -= 1;
    return;
  }
  const top = backLayers[backLayers.length - 1];
  if (!top) return;
  top.callback.current?.();
};

const ensurePopListener = () => {
  if (popListenerInstalled) return;
  window.addEventListener('popstate', onPopState, true);
  popListenerInstalled = true;
};

const removeLayer = (layer) => {
  const index = backLayers.lastIndexOf(layer);
  if (index >= 0) backLayers.splice(index, 1);
  // With no parent left there is nothing an old cleanup pop could accidentally close. Dropping stale
  // suppression also prevents a boundary no-op history.back() from affecting a later, unrelated overlay.
  if (backLayers.length === 0) ignoredPops = 0;
};

// Register a history level whose push/pop bookkeeping is owned by the caller (FileManager, Git,
// notifications, etc.). Sharing the same registry with useBackButton lets a custom multi-level sheet
// sit above Settings without Settings intercepting the sheet's Back event.
export function useHistoryLayer(active, onBack) {
  const cbRef = useRef(onBack);
  const layerRef = useRef(null);
  cbRef.current = onBack;
  if (!layerRef.current) layerRef.current = { id: nextOverlayId++, callback: cbRef };
  useEscapeLayer(active, () => window.history.back());
  useEffect(() => {
    if (!active) return undefined;
    const layer = layerRef.current;
    ensurePopListener();
    backLayers.push(layer);
    return () => removeLayer(layer);
  }, [active]);
}

// A custom multi-level owner is closing by an on-screen control and must drop all history entries it
// still owns. If another registered layer sits underneath, swallow the resulting popstate so cleanup
// cannot accidentally close that parent.
export function unwindHistory(depth) {
  if (depth <= 0) return;
  // React may remove the owner's registry layer before this cleanup runs, leaving only its parent
  // in backLayers. Any remaining registered layer must therefore be protected from the cleanup pop.
  if (backLayers.length > 0) ignoredPops += 1;
  window.history.go(-depth);
}

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
      removeLayer(layer);
      // Still on top → closed by a button, not Back: pop our own entry. After a real Back the entry
      // is already gone (state no longer ours), so we leave history alone. If a parent layer remains,
      // swallow this cleanup pop so it cannot close that parent as a side effect.
      if (window.history.state?.overlayId === layer.id) {
        if (backLayers.length > 0) ignoredPops += 1;
        window.history.back();
      }
    };
  }, [active]);
}

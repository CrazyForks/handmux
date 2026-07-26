import { useEffect, useRef } from 'react';

// Desktop Escape is a visual-layer operation, not a broadcast. Keeping one shared stack prevents
// nested dialogs, menus and sheets from all seeing the same keydown and closing in one stroke.
const layers = [];

const onKeyDown = (event) => {
  if (event.key !== 'Escape' || event.repeat || event.isComposing) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  top.callback.current?.();
};

export function useEscapeLayer(active, onEscape) {
  const callback = useRef(onEscape);
  const layer = useRef(null);
  callback.current = onEscape;
  if (!layer.current) layer.current = { callback };

  useEffect(() => {
    if (!active) return undefined;
    const entry = layer.current;
    layers.push(entry);
    if (layers.length === 1) window.addEventListener('keydown', onKeyDown, true);
    return () => {
      const index = layers.lastIndexOf(entry);
      if (index >= 0) layers.splice(index, 1);
      if (layers.length === 0) window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [active]);
}

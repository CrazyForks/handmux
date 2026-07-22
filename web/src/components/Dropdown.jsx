import { useState, useRef, useEffect } from 'react';

// Our own themed dropdown — a native <select> can't be styled consistently across iOS/Android, and
// its wheel picker clashes with the app's dark modal. A field-styled trigger opens a themed menu;
// it closes on picking an option or on a pointerdown anywhere outside. Pointer-friendly (tap targets,
// no hover dependency). options: [{ value, label }]. value selects the shown/checked option.
export default function Dropdown({ value, options, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = options.find((o) => o.value === value) || options[0];

  // Close when a tap/click lands outside the dropdown (capture phase so it beats other handlers).
  useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDocDown, true);
    return () => document.removeEventListener('pointerdown', onDocDown, true);
  }, [open]);

  return (
    <div className="dd" ref={rootRef}>
      <button
        type="button"
        className="field dd-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="dd-value">{selected?.label}</span>
        <span className={`dd-caret${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="dd-menu" role="listbox">
          {options.map((o) => (
            <button
              type="button"
              key={o.value || '__none__'}
              role="option"
              aria-selected={o.value === value}
              className={`dd-option${o.value === value ? ' is-selected' : ''}`}
              onClick={() => { onChange?.(o.value); setOpen(false); }}
            >
              <span className="dd-option-label">{o.label}</span>
              {o.value === value && <span className="dd-check" aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

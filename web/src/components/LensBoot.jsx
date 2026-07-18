// Branded waiting state shared by BOTH lenses: the handmux wordmark breathing softly, a three-dot wave,
// and a friendly hint. Shown while the lens's first content is on its way — and standing in for an empty
// session (a bare "nothing here" reads as broken; a named wait reads as progress).
// pointer-events:none: it never intercepts taps meant for the surface beneath.
export default function LensBoot({ hint }) {
  return (
    <div className="lens-boot" aria-live="polite">
      <div className="lens-boot-word">handmux</div>
      <div className="lens-boot-dots" aria-hidden="true">
        <span className="lens-boot-dot" />
        <span className="lens-boot-dot" />
        <span className="lens-boot-dot" />
      </div>
      {hint && <div className="lens-boot-hint">{hint}</div>}
    </div>
  );
}

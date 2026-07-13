import { useState, useRef, useEffect } from 'react';

// The transient cols×rows·font readout that flashes for ~3s after a ⊟/⊞ column step (App calls flash()
// through the terminal's imperative handle). Fully self-contained and component-scope — it never touched
// the poll/gesture/selection machinery in Terminal's main effect. It polls the size briefly because
// term.cols only catches up on the next ~1s refresh. `termRef` is Terminal's xterm ref.
export function useFlash(termRef) {
  const [dbg, setDbg] = useState('');          // cols×rows·font readout
  const [dbgVisible, setDbgVisible] = useState(false);
  const flashHideRef = useRef(null);
  const flashPollRef = useRef(null);
  useEffect(() => () => {
    clearTimeout(flashHideRef.current);
    clearInterval(flashPollRef.current);
  }, []);

  const flash = () => {
    const read = () => {
      const term = termRef.current;
      if (term) setDbg(`${term.cols}×${term.rows} · ${term.options.fontSize}px`);
    };
    read();
    setDbgVisible(true);
    clearTimeout(flashHideRef.current);
    clearInterval(flashPollRef.current);
    flashPollRef.current = setInterval(read, 400);
    flashHideRef.current = setTimeout(() => {
      setDbgVisible(false);
      clearInterval(flashPollRef.current);
    }, 3000);
  };

  return { dbg, dbgVisible, flash };
}

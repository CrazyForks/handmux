import { Terminal as XTerm } from '@xterm/xterm';
import { TERMINAL_FONT_FAMILY } from './terminalXterm.js';

const write = (term, data) => new Promise((resolve) => term.write(data, resolve));

// A small read-only xterm that paints only the history rows immediately above the exact live grid.
// The source terminal stays pane-sized and owns the raw tmux stream; SerializeAddon gives this view
// the source buffer's real cell colours/attributes without interpreting those pane-sized cursor
// commands in a differently-sized terminal.
export function openTerminalHistoryPreview(host, { fontSize, scrollback }) {
  const term = new XTerm({
    allowProposedApi: true,
    disableStdin: true,
    cursorBlink: false,
    cursorStyle: 'bar',
    scrollback,
    convertEol: false,
    fontSize,
    fontFamily: TERMINAL_FONT_FAMILY,
  });
  term.open(host);
  const helper = host.querySelector('.xterm-helper-textarea');
  if (helper) {
    helper.readOnly = true;
    helper.tabIndex = -1;
    helper.setAttribute('inputmode', 'none');
    helper.setAttribute('aria-hidden', 'true');
  }

  let disposed = false;
  let busy = false;
  let pending = null;

  const flush = async () => {
    if (busy || disposed) return;
    busy = true;
    while (pending && !disposed) {
      const frame = pending;
      pending = null;
      term.options.fontSize = frame.fontSize;
      if (term.cols !== frame.cols || term.rows !== frame.rows) {
        term.resize(frame.cols, frame.rows);
      }
      host.style.height = `${frame.height}px`;
      await write(term, `\x1b[?25l\x1b[0m\x1b[2J\x1b[3J\x1b[H${frame.ansi}`);
      if (!disposed) term.scrollToTop();
    }
    busy = false;
  };

  return {
    render(frame) {
      if (disposed) return;
      pending = frame;
      flush();
    },
    hide() {
      pending = null;
      host.hidden = true;
      host.style.height = '0px';
    },
    show() {
      host.hidden = false;
    },
    dispose() {
      disposed = true;
      pending = null;
      term.dispose();
    },
  };
}

import { Terminal as XTerm } from '@xterm/xterm';
import { SerializeAddon } from '@xterm/addon-serialize';
import { cursorSeq, prepareLiveSeed } from './terminalSeed.js';

const DEFAULT_RENDER_SCROLLBACK = 100;

const write = (term, data) => new Promise((resolve) => term.write(data, resolve));

function cursorVisibility(data, previous) {
  let ascii = previous.tail;
  for (const byte of data) ascii += byte < 0x80 ? String.fromCharCode(byte) : ' ';
  let visible = previous.visible;
  for (const match of ascii.matchAll(/\x1b\[\?25([hl])/g)) visible = match[1] === 'h';
  return { visible, tail: ascii.slice(-8) };
}

function mouseTracking(data, previous) {
  let ascii = previous.tail;
  for (const byte of data) ascii += byte < 0x80 ? String.fromCharCode(byte) : ' ';
  let active = previous.active;
  for (const match of ascii.matchAll(/\x1b\[\?(9|1000|1002|1003)([hl])/g)) {
    active = match[2] === 'h';
  }
  return { active, tail: ascii.slice(-12) };
}

// An exact pane-sized xterm core with no DOM renderer. Raw tmux bytes always land here, so their
// cursor-addressing semantics stay correct. The UI consumes immutable serialized revisions from it
// and can therefore use one independently-sized visible xterm for both history and the live pane.
export function createTerminalStreamMirror({
  scrollback,
  renderScrollback = DEFAULT_RENDER_SCROLLBACK,
  TerminalCtor = XTerm,
  SerializeAddonCtor = SerializeAddon,
} = {}) {
  let term = null;
  let serializer = null;
  let disposed = false;
  let seeded = false;
  let ready = false;
  let seedRows = 0;
  let revision = 0;
  let cursor = { visible: false, tail: '' };
  let mouse = { active: false, tail: '' };

  const ensureOpen = () => {
    if (disposed) throw new Error('terminal stream mirror disposed');
  };

  return {
    async seed(frame) {
      ensureOpen();
      const nextTerm = new TerminalCtor({
        allowProposedApi: true,
        scrollback,
        convertEol: false,
      });
      const nextSerializer = new SerializeAddonCtor();
      nextTerm.loadAddon(nextSerializer);
      if (nextTerm.cols !== frame.width || nextTerm.rows !== frame.height) {
        nextTerm.resize(frame.width, frame.height);
      }
      const seed = prepareLiveSeed(frame.ansi, frame.height);
      const screenMode = frame.alt ? '\x1b[?1049h' : '\x1b[?1049l';
      try {
        await write(nextTerm, `${screenMode}\x1b[?25l\x1b[0m\x1b[2J\x1b[3J\x1b[H${seed}`);
        ensureOpen();
      } catch (error) {
        nextTerm.dispose();
        throw error;
      }
      const previousTerm = term;
      term = nextTerm;
      serializer = nextSerializer;
      previousTerm?.dispose();
      ready = false;
      cursor = { visible: false, tail: '' };
      mouse = { active: !!frame.mouseAware, tail: '' };
      seedRows = seed ? seed.split('\r\n').length : 0;
      seeded = true;
      revision += 1;
    },

    async data(bytes) {
      ensureOpen();
      cursor = cursorVisibility(bytes, cursor);
      mouse = mouseTracking(bytes, mouse);
      await write(term, bytes);
      ensureOpen();
      revision += 1;
    },

    async ready(cur) {
      ensureOpen();
      cursor.visible = !!cur?.vis;
      await write(term, cursorSeq(cur, term.rows, seedRows));
      ensureOpen();
      ready = true;
      revision += 1;
    },

    snapshot() {
      ensureOpen();
      if (!seeded || !ready) return null;
      const active = term.buffer.active;
      // The hidden core remains the complete, pane-sized terminal state. The visible terminal is only a
      // projection, so repainting its entire accumulated scrollback on every output revision is wasted
      // work (and eventually blocks the browser for tens of milliseconds per frame). Keep one history
      // page beside the live grid; deeper scrolling already switches to the snapshot history loader.
      const visibleBufferRows = active.type === 'alternate'
        ? active.length
        : Math.min(active.length, term.rows + renderScrollback);
      const visibleBufferStart = active.type === 'alternate'
        ? 0
        : active.length - visibleBufferRows;
      const mouseMode = term.modes?.mouseTrackingMode;
      return {
        revision,
        ansi: serializer.serialize({ excludeModes: true, scrollback: renderScrollback }),
        cursorVisible: cursor.visible,
        alt: active.type === 'alternate',
        mouseAware: mouse.active || (!!mouseMode && mouseMode !== 'none'),
        boundaryLine: active.type === 'alternate'
          ? null
          : Math.max(0, term.buffer.normal.baseY - visibleBufferStart),
        bufferRows: visibleBufferRows,
        paneRows: term.rows,
        paneCols: term.cols,
      };
    },

    get revision() {
      return revision;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      term?.dispose();
    },
  };
}

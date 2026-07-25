import { Terminal as XTerm } from '@xterm/xterm';
import { SerializeAddon } from '@xterm/addon-serialize';
import { cursorSeq, prepareLiveSeed } from './terminalSeed.js';

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
  TerminalCtor = XTerm,
  SerializeAddonCtor = SerializeAddon,
} = {}) {
  const term = new TerminalCtor({
    allowProposedApi: true,
    scrollback,
    convertEol: false,
  });
  const serializer = new SerializeAddonCtor();
  term.loadAddon(serializer);

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
      ready = false;
      cursor = { visible: false, tail: '' };
      mouse = { active: !!frame.mouseAware, tail: '' };
      if (term.cols !== frame.width || term.rows !== frame.height) {
        term.resize(frame.width, frame.height);
      }
      const seed = prepareLiveSeed(frame.ansi, frame.height);
      seedRows = seed ? seed.split('\r\n').length : 0;
      const screenMode = frame.alt ? '\x1b[?1049h' : '\x1b[?1049l';
      await write(term, `${screenMode}\x1b[?25l\x1b[0m\x1b[2J\x1b[3J\x1b[H${seed}`);
      ensureOpen();
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
      const mouseMode = term.modes?.mouseTrackingMode;
      return {
        revision,
        ansi: serializer.serialize({ excludeModes: true }),
        cursorVisible: cursor.visible,
        alt: active.type === 'alternate',
        mouseAware: mouse.active || (!!mouseMode && mouseMode !== 'none'),
        boundaryLine: active.type === 'alternate' ? null : term.buffer.normal.baseY,
        bufferRows: active.length,
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
      term.dispose();
    },
  };
}

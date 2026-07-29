// @vitest-environment node
import { describe, expect, it } from 'vitest';
import headless from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { createTerminalStreamMirror } from '../src/terminalStreamMirror.js';
import { cursorSeq } from '../src/terminalSeed.js';

const { Terminal } = headless;
const write = (term, data) => new Promise((resolve) => term.write(data, resolve));
const textAt = (term, line) => term.buffer.active.getLine(line)?.translateToString(true).trimEnd();
const visibleText = (term) => {
  const buffer = term.buffer.active;
  return Array.from({ length: term.rows }, (_, row) => textAt(term, buffer.viewportY + row));
};
const shadedAt = (term, line, col = 0) => {
  const cell = term.buffer.active.getLine(line)?.getCell(col);
  return !!(cell && (cell.getBgColorMode() !== 0 || cell.isInverse()));
};

const create = () => createTerminalStreamMirror({
  scrollback: 100,
  TerminalCtor: Terminal,
  SerializeAddonCtor: SerializeAddon,
});

describe('terminal stream mirror', () => {
  it('uses the production xterm core without opening a DOM renderer', async () => {
    const mirror = createTerminalStreamMirror({ scrollback: 100 });
    await mirror.seed({
      ansi: 'history\nshell\n',
      width: 12,
      height: 1,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 0, col: 5, vis: true });

    expect(mirror.snapshot()).toMatchObject({
      boundaryLine: 1,
      bufferRows: 2,
      paneRows: 1,
      paneCols: 12,
      cursorVisible: true,
    });
    mirror.dispose();
  });

  it('keeps raw cursor addressing pane-exact while one taller terminal restores history and cursor atomically', async () => {
    const mirror = create();
    await mirror.seed({
      ansi: 'h0\nh1\nr0\nr1\nr2\n',
      width: 12,
      height: 3,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 1, col: 2, vis: true });
    // CUP is interpreted by the exact 3-row parser, not by the taller visible terminal.
    await mirror.data(new Uint8Array(Buffer.from('\x1b[3;5H!')));

    const frame = mirror.snapshot();
    const visible = new Terminal({ cols: 12, rows: 6, allowProposedApi: true, scrollback: 100 });
    const pad = '\r\n'.repeat(visible.rows - frame.bufferRows);
    await write(
      visible,
      `\x1b[?1049l\x1b[?25l\x1b[0m\x1b[2J\x1b[3J\x1b[H${pad}${frame.ansi}\x1b[?25h`,
    );

    expect(frame.boundaryLine).toBe(2);
    expect(frame.cursorVisible).toBe(true);
    expect(textAt(visible, 0)).toBe('');
    expect(textAt(visible, 1)).toBe('h0');
    expect(textAt(visible, 2)).toBe('h1');
    expect(textAt(visible, 3)).toBe('r0');
    expect(textAt(visible, 5)).toBe('r2  !');
    expect(visible.buffer.active.cursorY).toBe(5);
    expect(visible.buffer.active.cursorX).toBe(5);
    visible.dispose();
    mirror.dispose();
  });

  it('keeps the full parser state but bounds each visible repaint to one recent history page', async () => {
    const mirror = createTerminalStreamMirror({
      scrollback: 500,
      renderScrollback: 100,
      TerminalCtor: Terminal,
      SerializeAddonCtor: SerializeAddon,
    });
    const history = Array.from({ length: 250 }, (_, i) => `history-${String(i).padStart(3, '0')}`);
    await mirror.seed({
      ansi: [...history, 'live-0', 'live-1', 'live-2'].join('\n') + '\n',
      width: 20,
      height: 3,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 0, col: 6, vis: true });

    const frame = mirror.snapshot();
    expect(frame.bufferRows).toBe(103);
    expect(frame.boundaryLine).toBe(100);
    expect(frame.ansi).not.toContain('history-000');
    expect(frame.ansi).toContain('history-249');
    expect(frame.ansi).toContain('live-2');
    mirror.dispose();
  });

  it('bottom-aligns a sparse tall pane without changing its exact live parser grid', async () => {
    const mirror = createTerminalStreamMirror({
      scrollback: 500,
      renderScrollback: 100,
      TerminalCtor: Terminal,
      SerializeAddonCtor: SerializeAddon,
    });
    const history = Array.from({ length: 100 }, (_, i) => `history-${i}`);
    await mirror.seed({
      ansi: [...history, 'prompt', ...Array(59).fill('')].join('\n') + '\n',
      width: 20,
      height: 60,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 59, col: 6, vis: true });

    const frame = mirror.snapshot();
    expect(frame).toMatchObject({
      bufferRows: 104,
      boundaryLine: 100,
      cur: { row: 3, col: 6, vis: true },
    });
    const visible = new Terminal({ cols: 20, rows: 20, allowProposedApi: true, scrollback: 500 });
    const pad = Math.max(0, visible.rows - frame.bufferRows);
    await write(visible, `\x1b[2J\x1b[3J\x1b[H${'\r\n'.repeat(pad)}${frame.ansi}${cursorSeq(frame.cur, visible.rows, frame.bufferRows + pad)}`);
    visible.scrollToBottom();
    expect(visibleText(visible).slice(-4)).toEqual(['prompt', '', '', '']);
    expect(visible.buffer.active.cursorY).toBe(16);
    expect(visible.buffer.active.cursorX).toBe(6);

    const tallVisible = new Terminal({ cols: 20, rows: 120, allowProposedApi: true, scrollback: 500 });
    const tallPad = tallVisible.rows - frame.bufferRows;
    await write(tallVisible, `\x1b[2J\x1b[3J\x1b[H${'\r\n'.repeat(tallPad)}${frame.ansi}${cursorSeq(frame.cur, tallVisible.rows, frame.bufferRows + tallPad)}`);
    tallVisible.scrollToBottom();
    expect(visibleText(tallVisible).slice(-4)).toEqual(['prompt', '', '', '']);
    expect(tallVisible.buffer.active.cursorY).toBe(116);

    // A later pane-addressed write still targets row 60 in the untouched hidden parser. If the seed
    // itself had been trimmed, this would overwrite the wrong row instead of expanding the projection.
    await mirror.data(new Uint8Array(Buffer.from('\x1b[60;1Hbottom')));
    expect(mirror.snapshot()).toMatchObject({ bufferRows: 160, cur: null });
    expect(mirror.snapshot().ansi).toContain('bottom');
    visible.dispose();
    tallVisible.dispose();
    mirror.dispose();
  });

  it('does not trim a styled blank at the bottom of the live grid', async () => {
    const mirror = create();
    await mirror.seed({
      ansi: [
        'prompt',
        ...Array(53).fill(''),
        '\x1b[48;5;237m          ',
        '\x1b[49m',
        ...Array(4).fill(''),
      ].join('\n') + '\n',
      width: 10,
      height: 60,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 59, col: 6, vis: true });

    const frame = mirror.snapshot();
    expect(frame).toMatchObject({ bufferRows: 58, cur: { row: 57, col: 6, vis: true } });
    const visible = new Terminal({ cols: 10, rows: 60, allowProposedApi: true, scrollback: 100 });
    await write(visible, frame.ansi);
    expect(shadedAt(visible, 54, 0)).toBe(true);
    mirror.dispose();
    visible.dispose();
  });

  it('publishes cursor visibility, mouse mode and alternate-screen state from the same revision', async () => {
    const mirror = create();
    await mirror.seed({
      ansi: 'shell\n',
      width: 12,
      height: 3,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 0, col: 0, vis: true });
    await mirror.data(new Uint8Array(Buffer.from('\x1b[?25l\x1b[?1000h\x1b[?1049h\x1b[Happ')));

    const frame = mirror.snapshot();
    expect(frame.alt).toBe(true);
    expect(frame.cursorVisible).toBe(false);
    expect(frame.mouseAware).toBe(true);
    expect(frame.boundaryLine).toBeNull();
    mirror.dispose();
  });

  it('preserves Codex bottom shading through serialization into a taller visible grid', async () => {
    const mirror = create();
    await mirror.seed({
      ansi: '\x1b[48;5;237m          \n❯ hi      \n          \n\x1b[49mout\n',
      width: 10,
      height: 4,
      alt: false,
      mouseAware: false,
    });
    await mirror.ready({ row: 0, col: 3, vis: true });
    const frame = mirror.snapshot();
    const visible = new Terminal({ cols: 10, rows: 6, allowProposedApi: true, scrollback: 100 });
    const pad = '\r\n'.repeat(visible.rows - frame.bufferRows);
    await write(visible, `\x1b[2J\x1b[3J\x1b[H${pad}${frame.ansi}`);

    expect(shadedAt(visible, 2, 0)).toBe(true);
    expect(shadedAt(visible, 3, 9)).toBe(true);
    expect(shadedAt(visible, 4, 0)).toBe(true);
    expect(shadedAt(visible, 5, 0)).toBe(false);
    visible.dispose();
    mirror.dispose();
  });

  it('starts a resync from a clean parser state', async () => {
    const frame = {
      ansi: 'h0\nh1\nr0\nr1\nr2\nr3\n',
      width: 8,
      height: 4,
      alt: false,
      mouseAware: false,
    };
    const reused = create();
    await reused.seed(frame);
    await reused.ready({ row: 3, col: 2, vis: true });
    // Full-screen terminal applications can leave private modes and scroll margins active.
    await reused.data(new Uint8Array(Buffer.from('\x1b[2;3r\x1b[?6h\x1b[2;1Hdirty')));
    await reused.seed(frame);
    await reused.ready({ row: 3, col: 2, vis: true });

    const fresh = create();
    await fresh.seed(frame);
    await fresh.ready({ row: 3, col: 2, vis: true });

    expect(reused.snapshot()).toMatchObject({
      ansi: fresh.snapshot().ansi,
      boundaryLine: fresh.snapshot().boundaryLine,
      bufferRows: fresh.snapshot().bufferRows,
    });
    reused.dispose();
    fresh.dispose();
  });
});

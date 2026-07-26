// @vitest-environment node
import { describe, expect, it } from 'vitest';
import headless from '@xterm/headless';
import { SerializeAddon } from '@xterm/addon-serialize';
import { createTerminalStreamMirror } from '../src/terminalStreamMirror.js';

const { Terminal } = headless;
const write = (term, data) => new Promise((resolve) => term.write(data, resolve));
const textAt = (term, line) => term.buffer.active.getLine(line)?.translateToString(true).trimEnd();
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

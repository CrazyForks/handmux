import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeControlData,
  echoTerminalProbe,
  PaneControlStream,
} from '../src/terminalStream.js';

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.writes = [];
    this.stdin = { write: (value) => { this.writes.push(value); } };
    this.kill = vi.fn();
  }

  lines(...lines) {
    this.stdout.emit('data', Buffer.from(`${lines.join('\n')}\n`));
  }
}

function fakeSocket() {
  return {
    readyState: 1,
    bufferedAmount: 0,
    messages: [],
    send(value, options) {
      this.messages.push(options?.binary ? Buffer.from(value) : JSON.parse(value));
    },
    close: vi.fn(),
  };
}

async function finishResync(child, {
  capture = ['one'],
  info = '80\t24\t4\t3\t1\t0\t0\t0',
  between,
} = {}) {
  await vi.waitFor(() => expect(child.writes.at(-1)).toContain('capture-pane'));
  child.lines('%begin 1 1 1', ...capture, '%end 1 1 1');
  between?.();
  await vi.waitFor(() => expect(child.writes.at(-1)).toContain('display-message'));
  const firstInfoWriteCount = child.writes.length;
  child.lines('%begin 2 2 1', info, '%end 2 2 1');
  if (info === 'not-pane-info') return;
  await vi.waitFor(() => expect(child.writes.length).toBeGreaterThan(firstInfoWriteCount));
  child.lines('%begin 3 3 1', info, '%end 3 3 1');
}

describe('terminal control data decoder', () => {
  it('decodes octal escapes without corrupting raw UTF-8 bytes', () => {
    const input = Buffer.concat([
      Buffer.from('中文', 'utf8'),
      Buffer.from('\\033[2K'),
    ]);
    expect(decodeControlData(input)).toEqual(Buffer.concat([
      Buffer.from('中文', 'utf8'),
      Buffer.from([0x1b]),
      Buffer.from('[2K'),
    ]));
  });

  it('preserves a literal backslash that is not an octal escape', () => {
    expect(decodeControlData(Buffer.from('a\\\\b'))).toEqual(Buffer.from('a\\b'));
  });
});

describe('terminal stream probe', () => {
  it('echoes only bounded numeric probe identifiers', () => {
    const ws = fakeSocket();
    expect(echoTerminalProbe(ws, { type: 'probe', id: 7 })).toBe(true);
    expect(ws.messages).toEqual([{ type: 'probe', id: 7 }]);
    expect(echoTerminalProbe(ws, { type: 'probe', id: '7' })).toBe(false);
    expect(echoTerminalProbe(ws, { type: 'pause' })).toBe(false);
  });
});

describe('PaneControlStream', () => {
  it('buffers output across a seed and then streams on the same tmux connection', async () => {
    const child = new FakeChild();
    const ws = fakeSocket();
    const spawnControl = vi.fn(() => child);
    const stream = new PaneControlStream({
      ws,
      pane: '%7',
      session: 'work',
      spawnControl,
    });
    const started = stream.start();
    child.lines('%session-changed $1 work');
    await finishResync(child, {
      between: () => child.lines('%output %7 +live\\033[2K'),
    });
    await started;

    expect(spawnControl).toHaveBeenCalledTimes(1);
    expect(child.writes[0]).toContain('capture-pane -p -e -N -S -100 -t %7');
    expect(ws.messages).toEqual([
      expect.objectContaining({ type: 'seed', ansi: 'one\n', width: 80, height: 24 }),
      Buffer.from('+live\x1b[2K'),
      { type: 'ready', cur: { row: 20, col: 4, vis: true } },
    ]);

    child.lines('%output %7 next');
    expect(ws.messages.at(-1)).toEqual(Buffer.from('next'));
    stream.close();
  });

  it('publishes ready before output reported after the pane-info boundary', async () => {
    const child = new FakeChild();
    const ws = fakeSocket();
    const stream = new PaneControlStream({
      ws,
      pane: '%7',
      session: 'work',
      spawnControl: () => child,
    });
    const started = stream.start();
    child.lines('%session-changed $1 work');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('capture-pane'));
    child.lines('%begin 1 1 1', 'screen', '%end 1 1 1', '%output %7 before');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('display-message'));
    const firstInfoWriteCount = child.writes.length;
    child.lines(
      '%begin 2 2 1',
      '80\t24\t4\t3\t1\t0\t0\t0',
      '%end 2 2 1',
    );
    await vi.waitFor(() => expect(child.writes.length).toBeGreaterThan(firstInfoWriteCount));
    child.lines(
      '%begin 3 3 1',
      '80\t24\t4\t3\t1\t0\t0\t0',
      '%end 3 3 1',
      '%output %7 after',
    );
    await started;

    expect(ws.messages).toEqual([
      expect.objectContaining({ type: 'seed', ansi: 'screen\n' }),
      Buffer.from('before'),
      { type: 'ready', cur: { row: 20, col: 4, vis: true } },
      Buffer.from('after'),
    ]);
    stream.close();
  });

  it('includes normal-screen history but strips main-screen history from alternate screens', async () => {
    const normalChild = new FakeChild();
    const normalSocket = fakeSocket();
    const normal = new PaneControlStream({
      ws: normalSocket,
      pane: '%7',
      session: 'work',
      spawnControl: () => normalChild,
    });
    const normalStarted = normal.start();
    normalChild.lines('%session-changed $1 work');
    await finishResync(normalChild, {
      capture: ['history', 'screen-1', 'screen-2'],
      info: '80\t2\t0\t1\t1\t0\t0\t0',
    });
    await normalStarted;
    expect(normalSocket.messages[0]).toEqual(expect.objectContaining({
      type: 'seed',
      ansi: 'history\nscreen-1\nscreen-2\n',
      historyLines: 1,
    }));
    normal.close();

    const alternateChild = new FakeChild();
    const alternateSocket = fakeSocket();
    const alternate = new PaneControlStream({
      ws: alternateSocket,
      pane: '%8',
      session: 'work',
      spawnControl: () => alternateChild,
    });
    const alternateStarted = alternate.start();
    alternateChild.lines('%session-changed $1 work');
    await finishResync(alternateChild, {
      capture: ['main-history', 'alt-1', 'alt-2'],
      info: '80\t2\t0\t1\t1\t1\t0\t0',
    });
    await alternateStarted;
    expect(alternateSocket.messages[0]).toEqual(expect.objectContaining({
      type: 'seed',
      ansi: 'alt-1\nalt-2\n',
      historyLines: 0,
    }));
    alternate.close();
  });

  it('restores an ambiguous blank row before publishing the live seed', async () => {
    const child = new FakeChild();
    const ws = fakeSocket();
    const stream = new PaneControlStream({
      ws,
      pane: '%7',
      session: 'work',
      spawnControl: () => child,
    });
    const started = stream.start();
    child.lines('%session-changed $1 work');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('capture-pane'));
    child.lines(
      '%begin 1 1 1',
      '\x1b[48;5;237m❯ hi   ',
      '        ',
      '\x1b[49mreply',
      '%end 1 1 1',
    );
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('display-message'));
    child.lines('%begin 2 2 1', '8\t3\t0\t2\t0\t0\t0\t0', '%end 2 2 1');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('-S 1 -E 1'));
    child.lines('%begin 3 3 1', '        ', '%end 3 3 1');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('display-message'));
    child.lines('%begin 4 4 1', '8\t3\t0\t2\t0\t0\t0\t0', '%end 4 4 1');
    await started;

    expect(ws.messages[0].ansi.split('\n')[1]).toBe('\x1b[49m        ');
    stream.close();
  });

  it('keeps a pause that arrives during resync and reuses the control connection later', async () => {
    const child = new FakeChild();
    const ws = fakeSocket();
    const spawnControl = vi.fn(() => child);
    const stream = new PaneControlStream({
      ws,
      pane: '%7',
      session: 'work',
      spawnControl,
    });
    const started = stream.start();
    child.lines('%session-changed $1 work');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('capture-pane'));
    child.lines('%begin 1 1 1', 'old', '%end 1 1 1');
    await vi.waitFor(() => expect(child.writes.at(-1)).toContain('display-message'));
    stream.pause();
    child.lines('%begin 2 2 1', '80\t24\t0\t0\t1\t0\t0\t0', '%end 2 2 1');
    await started;
    expect(ws.messages).toEqual([]);
    expect(stream.phase).toBe('paused');

    const resumed = stream.resync();
    await finishResync(child, { capture: ['new'] });
    await resumed;
    expect(spawnControl).toHaveBeenCalledTimes(1);
    expect(ws.messages[0]).toEqual(expect.objectContaining({ type: 'seed', ansi: 'new\n' }));
    expect(stream.phase).toBe('live');
    stream.close();
  });

  it('rejects pending control requests when closed', async () => {
    const child = new FakeChild();
    const stream = new PaneControlStream({
      ws: fakeSocket(),
      pane: '%7',
      session: 'work',
      spawnControl: () => child,
    });
    child.lines('%session-changed $1 work');
    const pending = stream.request('capture-pane -p -t %7');
    stream.close();
    await expect(pending).rejects.toThrow('closed');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid pane-info frame instead of sending unusable dimensions', async () => {
    const child = new FakeChild();
    const ws = fakeSocket();
    const stream = new PaneControlStream({
      ws,
      pane: '%7',
      session: 'work',
      spawnControl: () => child,
    });
    const started = stream.start();
    const rejected = expect(started).rejects.toThrow('invalid tmux pane info');
    child.lines('%session-changed $1 work');
    await finishResync(child, { info: 'not-pane-info' });
    await rejected;
    expect(ws.messages).toEqual([]);
    stream.close();
  });
});

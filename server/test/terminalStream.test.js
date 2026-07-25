import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { decodeControlData, PaneControlStream } from '../src/terminalStream.js';

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
  child.lines('%begin 2 2 1', info, '%end 2 2 1');
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
    expect(ws.messages).toEqual([
      expect.objectContaining({ type: 'seed', ansi: 'one\n', width: 80, height: 24 }),
      Buffer.from('+live\x1b[2K'),
      { type: 'ready', cur: { row: 20, col: 4, vis: true } },
    ]);

    child.lines('%output %7 next');
    expect(ws.messages.at(-1)).toEqual(Buffer.from('next'));
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

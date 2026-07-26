import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTerminalStream } from '../src/terminalStreamClient.js';
import { terminalStreamEnabled } from '../src/terminalTransport.js';

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(data) {
    this.onmessage?.({ data });
  }

  send(data) {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

describe('terminalStreamEnabled', () => {
  it('is enabled by default and supports an emergency query override', () => {
    expect(terminalStreamEnabled({ search: '?terminalStream=1' })).toBe(true);
    expect(terminalStreamEnabled({ search: '' })).toBe(true);
    expect(terminalStreamEnabled({ search: '?terminalStream=0' })).toBe(false);
    expect(terminalStreamEnabled({ search: '' }, 'snapshot')).toBe(false);
    expect(terminalStreamEnabled({ search: '?terminalStream=1' }, 'snapshot')).toBe(false);
  });
});

describe('openTerminalStream', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    window.history.replaceState({}, '', '/');
  });

  it('subscribes, serializes seed/output/ready, and resyncs on the same socket', async () => {
    const events = [];
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      onSeed: async () => events.push('seed'),
      onData: async () => events.push('data'),
      onReady: async () => events.push('ready'),
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    expect(ws.sent).toEqual([{ type: 'subscribe', token: 'secret', pane: '%7' }]);
    ws.message(JSON.stringify({ type: 'seed' }));
    ws.message(new Uint8Array([1, 2]).buffer);
    ws.message(JSON.stringify({ type: 'ready' }));
    await vi.waitFor(() => expect(events).toEqual(['seed', 'data', 'ready']));

    stream.resync();
    expect(ws.sent.at(-1)).toEqual({ type: 'resync' });
    stream.close();
  });

  it('measures application RTT on the live socket', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const onProbe = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      now: () => now,
      onProbe,
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message(JSON.stringify({ type: 'seed' }));
    const ready = JSON.stringify({ type: 'ready' });
    ws.message(ready);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(ws.sent.at(-1)).toEqual({ type: 'probe', id: 1 });

    now = 1086;
    ws.message(JSON.stringify({ type: 'probe', id: 1 }));
    expect(onProbe).toHaveBeenCalledWith({ ok: true, rttMs: 86 });

    stream.close();
    vi.useRealTimers();
  });

  it('reports a timed-out application probe without closing a healthy stream', async () => {
    vi.useFakeTimers();
    const onProbe = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      probeTimeoutMs: 20,
      onProbe,
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message(JSON.stringify({ type: 'seed' }));
    ws.message(JSON.stringify({ type: 'ready' }));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    vi.advanceTimersByTime(20);
    expect(onProbe).toHaveBeenCalledWith({ ok: false });
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    stream.close();
    vi.useRealTimers();
  });

  it('pauses without reconnecting and reconnects only when resuming', () => {
    vi.useFakeTimers();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      reconnectMs: 10,
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    stream.pause();
    expect(ws.sent.at(-1)).toEqual({ type: 'pause' });
    ws.close(1006);
    vi.advanceTimersByTime(20);
    expect(FakeWebSocket.instances).toHaveLength(1);

    stream.resync();
    expect(FakeWebSocket.instances).toHaveLength(2);
    stream.close();
    vi.useRealTimers();
  });

  it('suspends the socket and starts from a fresh connection when resumed', () => {
    const statuses = [];
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      onStatus: (status) => statuses.push(status),
    });
    const first = FakeWebSocket.instances[0];
    first.open();

    stream.pause();
    stream.suspend();
    expect(first.readyState).toBe(3);
    expect(statuses.at(-1)).toBe('paused');

    stream.resync();
    expect(FakeWebSocket.instances).toHaveLength(2);
    const second = FakeWebSocket.instances[1];
    second.open();
    expect(second.sent).toEqual([{ type: 'subscribe', token: 'secret', pane: '%7' }]);
    stream.close();
  });

  it('does not subscribe in the background when the socket opens after pausing', () => {
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
    });
    const ws = FakeWebSocket.instances[0];

    stream.pause();
    ws.open();
    expect(ws.sent).toEqual([]);

    stream.resync();
    expect(ws.sent).toEqual([{ type: 'subscribe', token: 'secret', pane: '%7' }]);
    stream.close();
  });

  it('drops queued frames across a pause and resync boundary', async () => {
    const seed = {};
    seed.promise = new Promise((resolve) => { seed.resolve = resolve; });
    const events = [];
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      onSeed: async () => {
        events.push('seed');
        await seed.promise;
      },
      onData: async () => events.push('stale-data'),
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message(JSON.stringify({ type: 'seed' }));
    ws.message(new Uint8Array([1]).buffer);
    await vi.waitFor(() => expect(events).toEqual(['seed']));

    stream.pause();
    stream.resync();
    seed.resolve();
    await stream.close();
    expect(events).toEqual(['seed']);
  });

  it('resyncs on the same socket instead of painting frames queued for over 300ms', async () => {
    vi.useFakeTimers();
    const seed = {};
    seed.promise = new Promise((resolve) => { seed.resolve = resolve; });
    let seedCount = 0;
    const onData = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      connectTimeoutMs: 30000,
      maxFrameLagMs: 300,
      onSeed: () => {
        seedCount += 1;
        return seedCount === 1 ? seed.promise : undefined;
      },
      onData,
    });
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message(JSON.stringify({ type: 'seed' }));
    first.message(new Uint8Array([1]).buffer);
    await Promise.resolve();

    vi.advanceTimersByTime(301);
    seed.resolve();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(onData).not.toHaveBeenCalled();
    expect(first.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(first.sent.at(-1)).toEqual({ type: 'resync' });

    first.message(new Uint8Array([2]).buffer);
    first.message(JSON.stringify({ type: 'ready' }));
    await Promise.resolve();
    expect(onData).not.toHaveBeenCalled();

    first.message(JSON.stringify({ type: 'seed' }));
    first.message(new Uint8Array([3]).buffer);
    first.message(JSON.stringify({ type: 'ready' }));
    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(1));
    expect([...onData.mock.calls[0][0]]).toEqual([3]);
    stream.close();
    vi.useRealTimers();
  });

  it('resyncs on the same socket when queued output exceeds the byte limit', async () => {
    const seed = {};
    seed.promise = new Promise((resolve) => { seed.resolve = resolve; });
    const onData = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      maxPendingDataBytes: 3,
      onSeed: () => seed.promise,
      onData,
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message(JSON.stringify({ type: 'seed' }));
    ws.message(new Uint8Array([1, 2]).buffer);
    ws.message(new Uint8Array([3, 4]).buffer);

    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.sent.at(-1)).toEqual({ type: 'resync' });

    seed.resolve();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    expect(onData).not.toHaveBeenCalled();
    stream.close();
  });

  it('does not treat a slow initial seed as an overloaded output queue', async () => {
    vi.useFakeTimers();
    const seed = {};
    seed.promise = new Promise((resolve) => { seed.resolve = resolve; });
    const onReady = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      maxFrameLagMs: 300,
      onSeed: () => seed.promise,
      onReady,
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    ws.message(JSON.stringify({ type: 'seed' }));
    ws.message(JSON.stringify({ type: 'ready' }));

    vi.advanceTimersByTime(301);
    seed.resolve();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(onReady).toHaveBeenCalledOnce();
    expect(ws.sent).not.toContainEqual({ type: 'resync' });
    stream.close();
    vi.useRealTimers();
  });

  it('does not open a second socket when resync is requested while connecting', () => {
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
    });
    stream.resync();
    stream.resync();
    expect(FakeWebSocket.instances).toHaveLength(1);
    stream.close();
  });

  it('ignores a stale socket close after a newer connection exists', () => {
    vi.useFakeTimers();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      reconnectMs: 10,
    });
    const first = FakeWebSocket.instances[0];
    first.open();
    first.close(1006);
    vi.advanceTimersByTime(10);
    const second = FakeWebSocket.instances[1];
    second.open();
    first.onclose?.({ code: 1006 });
    stream.resync();
    expect(second.sent.at(-1)).toEqual({ type: 'resync' });
    expect(FakeWebSocket.instances).toHaveLength(2);
    stream.close();
    vi.useRealTimers();
  });

  it('times out a connection that never produces a ready frame', () => {
    vi.useFakeTimers();
    const statuses = [];
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      reconnectMs: 1000,
      connectTimeoutMs: 20,
      onStatus: (status) => statuses.push(status),
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    vi.advanceTimersByTime(20);
    expect(ws.readyState).toBe(3);
    expect(statuses).toContain('reconnecting');
    stream.close();
    vi.useRealTimers();
  });
});

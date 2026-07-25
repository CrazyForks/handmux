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

  it('measures application RTT and received terminal bytes on the live socket', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const onProbe = vi.fn();
    const onTraffic = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      now: () => now,
      onProbe,
      onTraffic,
    });
    const ws = FakeWebSocket.instances[0];
    ws.open();
    const ready = JSON.stringify({ type: 'ready' });
    ws.message(ready);
    await Promise.resolve();
    await Promise.resolve();
    expect(ws.sent.at(-1)).toEqual({ type: 'probe', id: 1 });

    now = 1086;
    ws.message(JSON.stringify({ type: 'probe', id: 1 }));
    expect(onProbe).toHaveBeenCalledWith({ ok: true, rttMs: 86 });

    ws.message(new Uint8Array([1, 2, 3]).buffer);
    expect(onTraffic).toHaveBeenCalledWith(new TextEncoder().encode(ready).byteLength);
    expect(onTraffic).toHaveBeenCalledWith(3);
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
    ws.message(JSON.stringify({ type: 'ready' }));
    await Promise.resolve();
    await Promise.resolve();
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

  it('replaces the connection instead of painting a frame queued for over ten seconds', async () => {
    vi.useFakeTimers();
    const seed = {};
    seed.promise = new Promise((resolve) => { seed.resolve = resolve; });
    const onData = vi.fn();
    const stream = openTerminalStream({
      pane: '%7',
      token: 'secret',
      WebSocketCtor: FakeWebSocket,
      connectTimeoutMs: 30000,
      maxFrameLagMs: 10000,
      onSeed: () => seed.promise,
      onData,
    });
    const first = FakeWebSocket.instances[0];
    first.open();
    first.message(JSON.stringify({ type: 'seed' }));
    first.message(new Uint8Array([1]).buffer);
    await Promise.resolve();

    vi.advanceTimersByTime(10001);
    seed.resolve();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(onData).not.toHaveBeenCalled();
    expect(first.readyState).toBe(3);
    expect(FakeWebSocket.instances).toHaveLength(2);
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

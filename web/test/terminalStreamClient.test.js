import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openTerminalStream, terminalStreamEnabled } from '../src/terminalStreamClient.js';

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
  it('only enables the explicit query parameter', () => {
    expect(terminalStreamEnabled({ search: '?terminalStream=1' })).toBe(true);
    expect(terminalStreamEnabled({ search: '' })).toBe(false);
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
});

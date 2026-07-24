import { describe, expect, it, vi } from 'vitest';
import { createTerminalInputQueue } from '../src/terminalInputQueue.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('terminal input queue', () => {
  it('keeps one request in flight and preserves pane/data order', async () => {
    const first = deferred();
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true });
    const q = createTerminalInputQueue({ send });

    q.enqueue('%1', 'a');
    q.enqueue('%1', 'b');
    q.enqueue('%2', '你');

    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    first.resolve({ ok: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls).toEqual([
      ['%1', '6162'],
      ['%2', 'e4bda0'],
    ]);
  });

  it('does not retry an ambiguous failed batch', async () => {
    const onError = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error('network'));
    const q = createTerminalInputQueue({ send, onError });

    q.enqueue('%1', 'x');

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(send).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), '%1');
  });

  it('drains data appended while the first request is in flight', async () => {
    const first = deferred();
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true });
    const q = createTerminalInputQueue({ send });

    q.enqueue('%1', 'a');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    q.enqueue('%1', 'b');

    first.resolve({ ok: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]).toEqual(['%1', '62']);
  });

  it('splits a same-pane batch at the server byte limit without reordering', async () => {
    const first = deferred();
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true });
    const q = createTerminalInputQueue({ send });

    q.enqueue('%1', `${'a'.repeat(16384)}你`);

    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(send.mock.calls[0]).toEqual(['%1', '61'.repeat(16384)]);
    first.resolve({ ok: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]).toEqual(['%1', 'e4bda0']);
  });

  it('drops only queued data for the requested pane', async () => {
    const first = deferred();
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ ok: true });
    const q = createTerminalInputQueue({ send });

    q.enqueue('%1', 'a');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    q.enqueue('%1', 'b');
    q.enqueue('%2', 'c');
    await Promise.resolve();
    q.drop('%1');

    first.resolve({ ok: true });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]).toEqual(['%2', '63']);
  });

  it('reports delivery for the pane bound to each batch', async () => {
    const onDelivered = vi.fn();
    const send = vi.fn().mockResolvedValue({ ok: true });
    const q = createTerminalInputQueue({ send, onDelivered });

    q.enqueue('%1', 'a');
    q.enqueue('%2', 'b');

    await vi.waitFor(() => expect(onDelivered).toHaveBeenCalledTimes(2));
    expect(onDelivered.mock.calls).toEqual([['%1'], ['%2']]);
  });

  it('stops accepting and draining queued data after disposal', async () => {
    const first = deferred();
    const send = vi.fn().mockReturnValueOnce(first.promise);
    const q = createTerminalInputQueue({ send });

    q.enqueue('%1', 'a');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    q.enqueue('%2', 'b');
    await Promise.resolve();
    q.dispose();
    q.enqueue('%3', 'c');
    first.resolve({ ok: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledOnce();
  });
});

import React, { useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesktopTerminalInput } from '../src/hooks/useDesktopTerminalInput.js';
import { UnauthorizedError } from '../src/api.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function Harness({ pane, send, onAuthFail, terminal, expose }) {
  const terminalRef = useRef(terminal);
  terminalRef.current = terminal;
  expose.current = useDesktopTerminalInput({
    enabled: true,
    currentPane: pane,
    send,
    onAuthFail,
    terminalRef,
  });
  return null;
}

afterEach(() => cleanup());

describe('useDesktopTerminalInput', () => {
  it('keeps one ordered queue across pane remounts without waking the replacement for old delivery', async () => {
    const first = deferred();
    const send = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: true });
    const pane1Terminal = { wake: vi.fn(), inputFailed: vi.fn() };
    const pane2Terminal = { wake: vi.fn(), inputFailed: vi.fn() };
    const expose = { current: null };
    const view = render(
      <Harness pane="%1" send={send} terminal={pane1Terminal} expose={expose} />,
    );

    act(() => expose.current('%1', 'a'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('%1', '61'));

    view.rerender(
      <Harness pane="%2" send={send} terminal={pane2Terminal} expose={expose} />,
    );
    act(() => expose.current('%2', 'b'));
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ ok: true });
      await first.promise;
    });
    await vi.waitFor(() => expect(send).toHaveBeenNthCalledWith(2, '%2', '62'));

    expect(pane1Terminal.wake).not.toHaveBeenCalled();
    expect(pane2Terminal.wake).toHaveBeenCalledOnce();
  });

  it('keeps authentication failure global when an old pane request settles after a switch', async () => {
    const first = deferred();
    const send = vi.fn(() => first.promise);
    const onAuthFail = vi.fn();
    const pane1Terminal = { wake: vi.fn(), inputFailed: vi.fn() };
    const pane2Terminal = { wake: vi.fn(), inputFailed: vi.fn() };
    const expose = { current: null };
    const view = render(
      <Harness
        pane="%1"
        send={send}
        terminal={pane1Terminal}
        onAuthFail={onAuthFail}
        expose={expose}
      />,
    );
    act(() => expose.current('%1', 'a'));
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    view.rerender(
      <Harness
        pane="%2"
        send={send}
        terminal={pane2Terminal}
        onAuthFail={onAuthFail}
        expose={expose}
      />,
    );
    await act(async () => {
      first.reject(new UnauthorizedError());
      await first.promise.catch(() => {});
    });

    expect(onAuthFail).toHaveBeenCalledOnce();
    expect(pane2Terminal.inputFailed).not.toHaveBeenCalled();
  });
});

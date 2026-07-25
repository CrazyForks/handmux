import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

const mocks = vi.hoisted(() => ({
  instances: [],
  getHistory: vi.fn(() => new Promise(() => {})),
  sendInput: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

vi.mock('../src/api.js', () => ({
  UnauthorizedError: mocks.UnauthorizedError,
  getHistory: mocks.getHistory,
  scrollPane: vi.fn(),
  sendInput: mocks.sendInput,
  sendKeys: vi.fn(),
}));

vi.mock('../src/bundledFonts.js', () => ({
  ensureBundledFonts: vi.fn(() => new Promise(() => {})),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.buffer = {
        active: {
          baseY: 0,
          cursorX: 0,
          cursorY: 0,
          length: 24,
          viewportY: 0,
          getLine: () => undefined,
        },
      };
      this.focus = vi.fn(() => this.helper?.dispatchEvent(new FocusEvent('focus')));
      this.blur = vi.fn(() => this.helper?.dispatchEvent(new FocusEvent('blur')));
      this.refresh = vi.fn();
      this.dispose = vi.fn();
      this.write = vi.fn((_data, callback) => callback?.());
      this.resize = vi.fn((cols, rows) => { this.cols = cols; this.rows = rows; });
      this.scrollToBottom = vi.fn();
      this.scrollToTop = vi.fn();
      this.scrollToLine = vi.fn();
      this._subscriptions = [];
      this._selection = '';
      mocks.instances.push(this);
    }

    open(host) {
      const root = document.createElement('div');
      root.className = 'xterm';
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      const viewport = document.createElement('div');
      viewport.className = 'xterm-viewport';
      const helper = document.createElement('textarea');
      helper.className = 'xterm-helper-textarea';
      root.append(screen, viewport, helper);
      host.append(root);
      this.helper = helper;
    }

    loadAddon() {}
    registerLinkProvider() { return { dispose: vi.fn() }; }
    onScroll(callback) {
      this.onScrollCallback = callback;
      const sub = { dispose: vi.fn() };
      this._subscriptions.push(sub);
      return sub;
    }
    onData(callback) {
      this.onDataCallback = callback;
      const sub = { dispose: vi.fn() };
      this._subscriptions.push(sub);
      return sub;
    }
    onSelectionChange(callback) {
      this.onSelectionChangeCallback = callback;
      const sub = { dispose: vi.fn() };
      this._subscriptions.push(sub);
      return sub;
    }
    hasSelection() { return this._selection.length > 0; }
    getSelection() { return this._selection; }
    clearSelection() {
      this._selection = '';
      this.onSelectionChangeCallback?.();
    }
    setSelection(text) {
      this._selection = text;
      this.onSelectionChangeCallback?.();
    }
    attachCustomKeyEventHandler(callback) {
      this.customKeyHandler = callback;
    }
  },
}));

import RawTerminal from '../src/components/Terminal.jsx';
import { useDesktopTerminalInput } from '../src/hooks/useDesktopTerminalInput.js';

const Terminal = React.forwardRef(function QueuedTerminal(props, forwardedRef) {
  const terminalRef = React.useRef(null);
  const enqueue = useDesktopTerminalInput({
    enabled: props.desktop,
    currentPane: props.pane,
    terminalRef,
    onAuthFail: props.onAuthFail,
    send: mocks.sendInput,
  });
  const setRef = React.useCallback((value) => {
    terminalRef.current = value;
    if (typeof forwardedRef === 'function') forwardedRef(value);
    else if (forwardedRef) forwardedRef.current = value;
  }, [forwardedRef]);
  return <RawTerminal {...props} ref={setRef} onInputData={enqueue} />;
});

describe('desktop terminal input', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    mocks.getHistory.mockReset().mockImplementation(() => new Promise(() => {}));
    mocks.sendInput.mockReset();
    delete navigator.clipboard;
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
  });

  afterEach(() => {
    cleanup();
    delete navigator.platform;
  });

  it('keeps mobile xterm read-only and never exposes its helper textarea', () => {
    render(<Terminal pane="%1" desktop={false} />);

    const term = mocks.instances[0];
    expect(term.options.disableStdin).toBe(true);
    expect(term.helper.readOnly).toBe(true);
    expect(term.helper.getAttribute('inputmode')).toBe('none');
  });

  it('enables desktop stdin, focuses on mount, and queues onData for the captured pane', async () => {
    mocks.sendInput.mockResolvedValue({ ok: true });
    render(<Terminal pane="%1" desktop />);

    const term = mocks.instances[0];
    expect(term.options.disableStdin).toBe(false);
    expect(term.helper.readOnly).toBe(false);
    expect(term.helper.tabIndex).toBe(0);
    expect(term.helper.hasAttribute('inputmode')).toBe(false);
    expect(term.helper.hasAttribute('aria-hidden')).toBe(false);
    expect(term.helper.closest('.terminal').classList.contains('desktop-input')).toBe(true);
    expect(term.focus).toHaveBeenCalled();
    term.onDataCallback('a\u001b[A');
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledWith('%1', '611b5b41'));
  });

  it('allows pointer focus only for the desktop helper textarea', () => {
    expect(styles).toMatch(/\.terminal \.xterm-helper-textarea\s*\{[^}]*pointer-events:\s*none/);
    expect(styles).toMatch(/\.terminal\.desktop-input \.xterm-helper-textarea\s*\{[^}]*pointer-events:\s*auto/);
  });

  it('keeps the desktop input class after the first terminal frame is revealed', async () => {
    mocks.getHistory.mockResolvedValue({
      ansi: 'ready',
      hash: 'frame-1',
      width: 80,
      height: 24,
      alt: false,
      mouseAware: false,
      cur: { row: 23, col: 0, vis: true },
    });
    const view = render(<Terminal pane="%1" desktop />);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(view.container.querySelector('.terminal').classList.contains('terminal--loading')).toBe(false);
    expect(view.container.querySelector('.terminal').classList.contains('desktop-input')).toBe(true);
  });

  it('hands a desktop pointer tap back to terminal input instead of preserving composer focus', () => {
    const onTap = vi.fn();
    const view = render(<Terminal pane="%1" desktop autoFocusInput={false} onTap={onTap} />);
    const composer = document.createElement('textarea');
    view.container.append(composer);
    composer.focus();

    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    mocks.instances[0].helper.closest('.terminal').dispatchEvent(event);

    expect(onTap).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('routes a horizontal trackpad gesture past xterm to the outer terminal scroller', () => {
    const view = render(<Terminal pane="%1" desktop />);
    const host = view.container.querySelector('.terminal');
    Object.defineProperties(host, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 640 },
    });
    host.scrollLeft = 12;

    // Real trackpad swipes commonly carry a little deltaY noise. xterm treats any non-zero deltaY as
    // vertical scroll and cancels the whole wheel event, so Handmux must claim horizontal-dominant input
    // before it reaches xterm's inner viewport.
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 30,
      deltaY: 2,
    });
    view.container.querySelector('.xterm-screen').dispatchEvent(event);

    expect(host.scrollLeft).toBe(42);
    expect(event.defaultPrevented).toBe(true);
  });

  it('exposes focus controls and reports desktop xterm focus changes', () => {
    const ref = React.createRef();
    const onInputFocusChange = vi.fn();
    render(<Terminal ref={ref} pane="%1" desktop onInputFocusChange={onInputFocusChange} />);

    const term = mocks.instances[0];
    expect(onInputFocusChange).toHaveBeenCalledWith(true);
    const mountFocusCalls = term.focus.mock.calls.length;
    ref.current.focusInput();
    ref.current.blurInput();
    expect(term.focus).toHaveBeenCalledTimes(mountFocusCalls + 1);
    expect(term.blur).toHaveBeenCalledOnce();
    expect(onInputFocusChange.mock.calls).toEqual([[true], [true], [false]]);
  });

  it('can mount desktop input without focusing while an App overlay owns focus', () => {
    const onInputFocusChange = vi.fn();
    render(
      <Terminal
        pane="%1"
        desktop
        autoFocusInput={false}
        onInputFocusChange={onInputFocusChange}
      />,
    );

    expect(mocks.instances[0].focus).not.toHaveBeenCalled();
    expect(onInputFocusChange).not.toHaveBeenCalled();
  });

  it('uses the latest callback props without rebuilding xterm', async () => {
    const input = deferred();
    const firstAuthFail = vi.fn();
    const latestAuthFail = vi.fn();
    const firstFocusChange = vi.fn();
    const latestFocusChange = vi.fn();
    mocks.sendInput.mockReturnValue(input.promise);
    const view = render(
      <Terminal
        pane="%1"
        desktop
        onAuthFail={firstAuthFail}
        onInputFocusChange={firstFocusChange}
      />,
    );
    const term = mocks.instances[0];
    term.onDataCallback('x');
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledOnce());

    view.rerender(
      <Terminal
        pane="%1"
        desktop
        onAuthFail={latestAuthFail}
        onInputFocusChange={latestFocusChange}
      />,
    );
    term.helper.dispatchEvent(new FocusEvent('blur'));
    await act(async () => {
      input.reject(new mocks.UnauthorizedError());
      await input.promise.catch(() => {});
    });

    expect(mocks.instances).toHaveLength(1);
    expect(firstFocusChange.mock.calls).toEqual([[true]]);
    expect(latestFocusChange).toHaveBeenCalledWith(false);
    expect(firstAuthFail).not.toHaveBeenCalled();
    expect(latestAuthFail).toHaveBeenCalledOnce();
  });

  it('leaves browser Command shortcuts alone and forwards terminal control keys', async () => {
    mocks.sendInput.mockResolvedValue({ ok: true });
    render(<Terminal pane="%1" desktop />);

    const term = mocks.instances[0];
    for (const key of ['w', 'T', 'l', 'R']) {
      expect(term.customKeyHandler({ key, metaKey: true })).toBe(false);
    }

    const terminalKeys = [
      [{ key: 'c', ctrlKey: true }, '\u0003'],
      [{ key: 'r', ctrlKey: true }, '\u0012'],
      [{ key: 'Tab' }, '\t'],
      [{ key: 'Escape' }, '\u001b'],
      [{ key: 'ArrowUp' }, '\u001b[A'],
    ];
    for (const [event, data] of terminalKeys) {
      expect(term.customKeyHandler(event)).toBe(true);
      term.onDataCallback(data);
    }

    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledWith('%1', '0312091b1b5b41'));
  });

  it('uses native desktop copy shortcuts without turning Ctrl+C into copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<Terminal pane="%1" desktop />);
    const term = mocks.instances[0];
    term.setSelection('selected text');

    expect(term.customKeyHandler({ key: 'c', metaKey: true })).toBe(false);
    const preventDefault = vi.fn();
    expect(term.customKeyHandler({
      key: 'c',
      ctrlKey: true,
      shiftKey: true,
      preventDefault,
    })).toBe(false);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('selected text'));
    expect(preventDefault).toHaveBeenCalledOnce();

    expect(term.customKeyHandler({ key: 'c', ctrlKey: true })).toBe(true);
  });

  it('lets Windows and Linux paste shortcuts reach the browser paste event', () => {
    render(<Terminal pane="%1" desktop />);
    const term = mocks.instances[0];

    expect(term.customKeyHandler({ key: 'v', ctrlKey: true })).toBe(false);
    expect(term.customKeyHandler({ key: 'V', ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('lets Cmd+V paste on Apple platforms while preserving terminal Ctrl+V', () => {
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    });
    render(<Terminal pane="%1" desktop />);
    const term = mocks.instances[0];

    expect(term.customKeyHandler({ key: 'v', metaKey: true })).toBe(false);
    expect(term.customKeyHandler({ key: 'v', ctrlKey: true })).toBe(true);
  });

  it('pauses snapshot polling for a desktop mouse selection and resumes when it clears', async () => {
    mocks.getHistory.mockResolvedValue({ unchanged: true });
    const ref = React.createRef();
    render(<Terminal ref={ref} pane="%1" desktop />);
    await vi.waitFor(() => expect(mocks.getHistory).toHaveBeenCalledOnce());
    const term = mocks.instances[0];

    act(() => term.setSelection('keep me'));
    act(() => ref.current.wake());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.getHistory).toHaveBeenCalledOnce();

    act(() => term.setSelection(''));
    await vi.waitFor(() => expect(mocks.getHistory.mock.calls.length).toBeGreaterThan(1));
  });

  it('does not apply an in-flight snapshot after desktop selection begins', async () => {
    const frame = deferred();
    mocks.getHistory.mockReturnValue(frame.promise);
    render(<Terminal pane="%1" desktop />);
    await vi.waitFor(() => expect(mocks.getHistory).toHaveBeenCalledOnce());
    const term = mocks.instances[0];

    act(() => term.setSelection('keep me'));
    await act(async () => {
      frame.resolve({ unchanged: false, ansi: 'new output' });
      await frame.promise;
    });

    expect(term.write).not.toHaveBeenCalled();
  });

  it('uses plain Shift+Enter to enter draft mode without sending it to the terminal', () => {
    const onRequestDraft = vi.fn();
    render(<Terminal pane="%1" desktop onRequestDraft={onRequestDraft} />);
    const term = mocks.instances[0];
    const preventDefault = vi.fn();

    expect(term.customKeyHandler({
      key: 'Enter',
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
    })).toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(onRequestDraft).toHaveBeenCalledOnce();

    expect(term.customKeyHandler({
      key: 'Enter',
      shiftKey: true,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
    })).toBe(true);
  });

  it('wakes polling after a delivered desktop input batch', async () => {
    mocks.getHistory.mockResolvedValue({ unchanged: true });
    mocks.sendInput.mockResolvedValue({ ok: true });
    render(<Terminal pane="%1" desktop />);
    await vi.waitFor(() => expect(mocks.getHistory).toHaveBeenCalledOnce());
    const term = mocks.instances[0];

    await act(async () => {
      term.onDataCallback('x');
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(mocks.getHistory.mock.calls.length).toBeGreaterThan(1));
  });

  it('routes unauthorized input failures to authentication handling', async () => {
    const onAuthFail = vi.fn();
    mocks.sendInput.mockRejectedValue(new mocks.UnauthorizedError());
    render(<Terminal pane="%1" desktop onAuthFail={onAuthFail} />);

    await act(async () => {
      mocks.instances[0].onDataCallback('x');
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(onAuthFail).toHaveBeenCalledOnce());
  });

  it('marks the terminal disconnected after other input failures', async () => {
    mocks.sendInput.mockRejectedValue(new Error('offline'));
    const view = render(<Terminal pane="%1" desktop />);

    await act(async () => {
      mocks.instances[0].onDataCallback('x');
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(view.container.textContent).toContain('连接断开'));
  });

  it('shows an actionable message when desktop input targets a pane that has closed', () => {
    const ref = React.createRef();
    const view = render(<Terminal ref={ref} pane="%1" desktop />);
    const term = mocks.instances[0];

    act(() => ref.current.inputFailed({ status: 404, serverError: 'pane not found' }));

    expect(view.container.textContent).toContain('窗格已关闭');
    expect(view.container.textContent).toContain('切换');
    expect(view.container.textContent).not.toContain('连接断开');
    expect(term.helper.closest('.terminal').classList.contains('desktop-input')).toBe(true);
  });

  it('disposes desktop input subscriptions and the queue on unmount', async () => {
    mocks.sendInput.mockResolvedValue({ ok: true });
    const view = render(<Terminal pane="%1" desktop />);
    const term = mocks.instances[0];

    view.unmount();
    term.onDataCallback('late');
    await Promise.resolve();

    expect(term._subscriptions).toHaveLength(3);
    for (const sub of term._subscriptions) expect(sub.dispose).toHaveBeenCalledOnce();
    expect(mocks.sendInput).not.toHaveBeenCalled();
  });

  it('removes helper textarea focus listeners on unmount', () => {
    const onInputFocusChange = vi.fn();
    const view = render(
      <Terminal pane="%1" desktop autoFocusInput={false} onInputFocusChange={onInputFocusChange} />,
    );
    const helper = mocks.instances[0].helper;

    helper.dispatchEvent(new FocusEvent('focus'));
    expect(onInputFocusChange).toHaveBeenCalledWith(true);
    onInputFocusChange.mockClear();

    view.unmount();
    helper.dispatchEvent(new FocusEvent('blur'));
    expect(onInputFocusChange).not.toHaveBeenCalled();
  });

  it('ignores an in-flight input error that settles after unmount', async () => {
    const input = deferred();
    const onAuthFail = vi.fn();
    mocks.sendInput.mockReturnValue(input.promise);
    const view = render(<Terminal pane="%1" desktop onAuthFail={onAuthFail} />);
    mocks.instances[0].onDataCallback('x');
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledOnce());

    view.unmount();
    await act(async () => {
      input.reject(new mocks.UnauthorizedError());
      await input.promise.catch(() => {});
    });

    expect(onAuthFail).not.toHaveBeenCalled();
  });

  it('does not let an old pane delivery wake the replacement pane', async () => {
    const input = deferred();
    mocks.getHistory.mockResolvedValue({ unchanged: true });
    mocks.sendInput.mockReturnValue(input.promise);
    const view = render(<Terminal pane="%1" desktop />);
    mocks.instances[0].onDataCallback('x');
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledOnce());

    view.rerender(<Terminal pane="%2" desktop />);
    await vi.waitFor(() => expect(mocks.instances).toHaveLength(2));
    await vi.waitFor(() => expect(mocks.getHistory.mock.calls.length).toBeGreaterThanOrEqual(2));
    const callsAfterSwitch = mocks.getHistory.mock.calls.length;
    await act(async () => {
      input.resolve({ ok: true });
      await input.promise;
    });
    await Promise.resolve();

    expect(mocks.getHistory).toHaveBeenCalledTimes(callsAfterSwitch);
  });

  it('does not let an old pane error affect the replacement pane', async () => {
    const input = deferred();
    const onAuthFail = vi.fn();
    mocks.sendInput.mockReturnValue(input.promise);
    const view = render(<Terminal pane="%1" desktop onAuthFail={onAuthFail} />);
    mocks.instances[0].onDataCallback('x');
    await vi.waitFor(() => expect(mocks.sendInput).toHaveBeenCalledOnce());

    view.rerender(<Terminal pane="%2" desktop onAuthFail={onAuthFail} />);
    await act(async () => {
      input.reject(new Error('offline'));
      await input.promise.catch(() => {});
    });

    expect(onAuthFail).not.toHaveBeenCalled();
    expect(view.container.textContent).not.toContain('连接断开');
  });
});

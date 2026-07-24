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
      this.focus = vi.fn(() => this.onFocusCallback?.());
      this.blur = vi.fn(() => this.onBlurCallback?.());
      this.refresh = vi.fn();
      this.dispose = vi.fn();
      this.write = vi.fn((_data, callback) => callback?.());
      this._subscriptions = [];
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
    onFocus(callback) {
      this.onFocusCallback = callback;
      const sub = { dispose: vi.fn() };
      this._subscriptions.push(sub);
      return sub;
    }
    onBlur(callback) {
      this.onBlurCallback = callback;
      const sub = { dispose: vi.fn() };
      this._subscriptions.push(sub);
      return sub;
    }
    attachCustomKeyEventHandler(callback) {
      this.customKeyHandler = callback;
    }
  },
}));

import Terminal from '../src/components/Terminal.jsx';

describe('desktop terminal input', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
    mocks.getHistory.mockReset().mockImplementation(() => new Promise(() => {}));
    mocks.sendInput.mockReset();
  });

  afterEach(() => cleanup());

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

  it('disposes desktop input subscriptions and the queue on unmount', async () => {
    mocks.sendInput.mockResolvedValue({ ok: true });
    const view = render(<Terminal pane="%1" desktop />);
    const term = mocks.instances[0];

    view.unmount();
    term.onDataCallback('late');
    await Promise.resolve();

    expect(term._subscriptions).toHaveLength(4);
    for (const sub of term._subscriptions) expect(sub.dispose).toHaveBeenCalledOnce();
    expect(mocks.sendInput).not.toHaveBeenCalled();
  });
});

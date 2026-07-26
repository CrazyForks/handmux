import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTerminalTouchController } from '../src/terminalTouchController.js';

const touchEvent = (type, y, touches = 1) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: touches ? [{ clientX: 100, clientY: y }] : [],
  });
  return event;
};

function setup() {
  const host = document.createElement('div');
  const live = document.createElement('div');
  live.className = 'terminal__live';
  const viewport = document.createElement('div');
  viewport.className = 'xterm-viewport';
  const screen = document.createElement('div');
  screen.className = 'xterm-screen';
  live.append(viewport, screen);
  host.append(live);
  document.body.append(host);

  const term = {
    options: { fontSize: 14 },
    buffer: { active: { viewportY: 0, baseY: 300 } },
    getSelection: () => '',
  };
  let controller;
  const maybePullMore = vi.fn(() => controller.freezeHistoryGesture());
  const armHistoryPull = vi.fn();
  controller = createTerminalTouchController({
    term,
    host,
    desktop: false,
    pane: '%1',
    fontRef: { current: null },
    selection: {
      start: vi.fn(),
      extend: vi.fn(),
      refresh: vi.fn(),
      clear: vi.fn(),
    },
    selectionActiveRef: { current: false },
    stopFlingRef: { current: null },
    getStreamExact: () => false,
    getAltScreen: () => false,
    getMouseAware: () => false,
    onActivity: vi.fn(),
    onUserScroll: vi.fn(),
    armHistoryPull,
    showScrollPosition: vi.fn(),
    maybePullMore,
    enterStreamHistory: vi.fn(),
    scheduleFit: vi.fn(),
    wake: vi.fn(),
    onTap: vi.fn(),
    onKeepKeyboard: vi.fn(),
  });
  return { controller, host, screen, maybePullMore, armHistoryPull };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('terminal touch history pull', () => {
  it('freezes the triggering drag until touchend so xterm cannot overwrite the restored anchor', () => {
    const { controller, screen, maybePullMore } = setup();
    const reachedXterm = vi.fn();
    screen.addEventListener('touchmove', reachedXterm);

    screen.dispatchEvent(touchEvent('touchstart', 100));
    const triggeringMove = touchEvent('touchmove', 130);
    screen.dispatchEvent(triggeringMove);
    screen.dispatchEvent(touchEvent('touchmove', 170));

    expect(maybePullMore).toHaveBeenCalledOnce();
    expect(triggeringMove.defaultPrevented).toBe(true);
    expect(reachedXterm).not.toHaveBeenCalled();

    screen.dispatchEvent(touchEvent('touchend', 170, 0));
    maybePullMore.mockImplementation(() => {});
    screen.dispatchEvent(touchEvent('touchstart', 170));
    screen.dispatchEvent(touchEvent('touchmove', 200));

    expect(reachedXterm).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it('loads immediately but absorbs the rest of the same wheel burst', () => {
    vi.useFakeTimers();
    const {
      controller, screen, maybePullMore, armHistoryPull,
    } = setup();
    const reachedXterm = vi.fn();
    screen.addEventListener('wheel', reachedXterm);

    const first = new WheelEvent('wheel', {
      deltaY: -40, bubbles: true, cancelable: true,
    });
    screen.dispatchEvent(first);
    screen.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -40, bubbles: true, cancelable: true,
    }));

    expect(maybePullMore).toHaveBeenCalledOnce();
    expect(armHistoryPull).toHaveBeenCalledOnce();
    expect(first.defaultPrevented).toBe(true);
    expect(reachedXterm).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    screen.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -40, bubbles: true, cancelable: true,
    }));

    expect(maybePullMore).toHaveBeenCalledTimes(2);
    expect(armHistoryPull).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});

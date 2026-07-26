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
  const loadMoreHistory = vi.fn();
  const controller = createTerminalTouchController({
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
    canPullHistory: () => true,
    loadMoreHistory,
    onHistoryPullChange: vi.fn(),
    showScrollPosition: vi.fn(),
    enterStreamHistory: vi.fn(),
    scheduleFit: vi.fn(),
    wake: vi.fn(),
    onTap: vi.fn(),
    onKeepKeyboard: vi.fn(),
  });
  return { controller, host, screen, loadMoreHistory };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('terminal touch history pull', () => {
  it('isolates the top pull and loads only after touchend', () => {
    const { controller, screen, loadMoreHistory } = setup();
    const reachedXterm = vi.fn();
    screen.addEventListener('touchmove', reachedXterm);

    screen.dispatchEvent(touchEvent('touchstart', 100));
    screen.dispatchEvent(touchEvent('touchmove', 140));
    screen.dispatchEvent(touchEvent('touchmove', 170));
    screen.dispatchEvent(touchEvent('touchmove', 180));

    expect(loadMoreHistory).not.toHaveBeenCalled();
    expect(reachedXterm).not.toHaveBeenCalled();

    screen.dispatchEvent(touchEvent('touchend', 180, 0));
    expect(loadMoreHistory).toHaveBeenCalledOnce();
    controller.dispose();
  });
});

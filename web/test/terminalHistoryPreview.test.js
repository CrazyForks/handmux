import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ instances: [] }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    constructor(options) {
      this.options = options;
      this.cols = 80;
      this.rows = 24;
      this.dispose = vi.fn();
      this.scrollToTop = vi.fn();
      mocks.instances.push(this);
    }

    open(host) {
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      screen.getBoundingClientRect = () => ({
        x: 0, y: 0, top: 0, left: 0, right: this.cols * 8, bottom: this.rows * 11,
        width: this.cols * 8, height: this.rows * 11, toJSON() {},
      });
      const helper = document.createElement('textarea');
      helper.className = 'xterm-helper-textarea';
      host.append(screen, helper);
    }

    resize(cols, rows) {
      this.cols = cols;
      this.rows = rows;
    }

    write(_data, callback) {
      callback?.();
    }
  },
}));

vi.mock('../src/terminalXterm.js', () => ({
  TERMINAL_FONT_FAMILY: 'monospace',
}));

import { openTerminalHistoryPreview } from '../src/terminalHistoryPreview.js';

describe('terminal history preview', () => {
  beforeEach(() => {
    mocks.instances.length = 0;
  });

  it('uses its rendered full-row height instead of clipping to the live renderer estimate', async () => {
    const host = document.createElement('div');
    const preview = openTerminalHistoryPreview(host, { fontSize: 14, scrollback: 100 });
    const onLayout = vi.fn();

    preview.show();
    preview.render({
      ansi: 'history',
      cols: 80,
      rows: 16,
      fontSize: 14,
      height: 160,
      onLayout,
    });
    await vi.waitFor(() => expect(host.style.height).toBe('176px'));

    expect(mocks.instances[0].scrollToTop).toHaveBeenCalledOnce();
    expect(onLayout).toHaveBeenCalledOnce();
    preview.dispose();
  });
});

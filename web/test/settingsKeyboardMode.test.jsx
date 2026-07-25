import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/push.js', () => ({
  notifyEnabled: () => false, enableNotifications: vi.fn(), disableNotifications: vi.fn(), pushSupported: () => false,
}));
vi.mock('../src/api.js', () => ({ fetchPaneCwd: vi.fn(async () => ({ cwd: '/home/u/proj' })) }));

import Settings from '../src/components/Settings.jsx';

let container;
let root;
const termRef = { current: { getFontSize: () => ({ size: 14, auto: false }) } };

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const render = (props = {}) => act(() => root.render(
  <Settings open onClose={() => {}} termRef={termRef}
    onColAdjust={() => {}} onColRestore={() => {}} onOpenChangelog={() => {}} changelogUnread={false}
    {...props} />,
));

describe('Settings keyboard mode', () => {
  it('shows Auto, Mobile, and Desktop with the current choice selected', async () => {
    await render({ keyboardMode: 'auto' });
    const group = container.querySelector('[role="group"][aria-label="键盘模式"]');
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['自动识别', '手机', '电脑']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });

  it('reports a manual mode change immediately', async () => {
    const onKeyboardMode = vi.fn();
    await render({ keyboardMode: 'auto', onKeyboardMode });
    const desktop = [...container.querySelectorAll('[aria-label="键盘模式"] button')]
      .find((button) => button.textContent === '电脑');
    act(() => desktop.click());
    expect(onKeyboardMode).toHaveBeenCalledWith('desktop');
  });
});

describe('Settings terminal refresh mode', () => {
  it('shows real-time first and selected by default', async () => {
    await render({ terminalTransport: 'live' });
    const group = container.querySelector('[role="group"][aria-label="终端刷新模式"]');
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['实时更新', '定时刷新']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });

  it('reports switching this browser to snapshot refresh', async () => {
    const onTerminalTransport = vi.fn();
    await render({ terminalTransport: 'live', onTerminalTransport });
    const snapshot = [...container.querySelectorAll('[aria-label="终端刷新模式"] button')]
      .find((button) => button.textContent === '定时刷新');
    act(() => snapshot.click());
    expect(onTerminalTransport).toHaveBeenCalledWith('snapshot');
  });

  it('shows and changes the active refresh interval only in timed-refresh mode', async () => {
    const onSnapshotInterval = vi.fn();
    await render({
      terminalTransport: 'snapshot',
      snapshotInterval: 1200,
      onSnapshotInterval,
    });
    const group = container.querySelector('[role="group"][aria-label="活跃时刷新频率"]');
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['0.8s', '1s', '1.2s', '1.5s', '2s']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed')))
      .toEqual(['false', 'false', 'true', 'false', 'false']);
    act(() => buttons[3].click());
    expect(onSnapshotInterval).toHaveBeenCalledWith(1500);

    await render({ terminalTransport: 'live' });
    expect(container.querySelector('[aria-label="活跃时刷新频率"]')).toBeNull();
  });
});

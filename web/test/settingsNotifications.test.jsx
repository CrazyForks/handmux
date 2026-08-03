import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const pushState = vi.hoisted(() => ({
  enabled: true,
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
}));

vi.mock('../src/push.js', () => ({
  notifyEnabled: () => pushState.enabled,
  enableNotifications: pushState.enable,
  disableNotifications: pushState.disable,
  pushSupported: () => true,
  getScriptPushKey: vi.fn(async () => 'device-key'),
}));

import Settings from '../src/components/Settings.jsx';

let container;
let root;
const termRef = { current: { getFontSize: () => ({ size: 14, auto: false }) } };

beforeEach(() => {
  localStorage.setItem('tw_lang', 'zh');
  pushState.enabled = true;
  pushState.enable.mockClear();
  pushState.disable.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

const notificationGroup = () => [...container.querySelectorAll('.settings-page-group')]
  .find((group) => group.querySelector('h2')?.textContent === '通知');

describe('Settings notifications', () => {
  it('places script push before script push history and uses the specific history title', () => {
    act(() => root.render(<Settings open onClose={() => {}} termRef={termRef} />));
    const labels = [...notificationGroup().querySelectorAll('.settings-page-row-label')]
      .map((item) => item.textContent);
    expect(labels).toEqual(['推送通知', '脚本推送', '脚本推送记录']);
  });

  it('requires confirmation before disabling push notifications', async () => {
    act(() => root.render(<Settings open onClose={() => {}} termRef={termRef} />));
    const toggle = notificationGroup().querySelector('input[type="checkbox"]');
    expect(toggle.checked).toBe(true);

    act(() => toggle.click());
    expect(container.querySelector('[role="alertdialog"]')).toBeTruthy();
    expect(pushState.disable).not.toHaveBeenCalled();
    expect(toggle.checked).toBe(true);

    const cancel = [...container.querySelectorAll('.settings-confirm-actions button')]
      .find((button) => button.textContent === '取消');
    act(() => cancel.click());
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(pushState.disable).not.toHaveBeenCalled();

    act(() => toggle.click());
    const confirm = [...container.querySelectorAll('.settings-confirm-actions button')]
      .find((button) => button.textContent === '关闭推送');
    await act(async () => {
      confirm.click();
      await Promise.resolve();
    });
    expect(pushState.disable).toHaveBeenCalledOnce();
    expect(toggle.checked).toBe(false);
  });

  it('enables push immediately without showing the disable confirmation', async () => {
    pushState.enabled = false;
    act(() => root.render(<Settings open onClose={() => {}} termRef={termRef} />));
    const toggle = notificationGroup().querySelector('input[type="checkbox"]');

    await act(async () => {
      toggle.click();
      await Promise.resolve();
    });
    expect(pushState.enable).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(toggle.checked).toBe(true);
  });
});

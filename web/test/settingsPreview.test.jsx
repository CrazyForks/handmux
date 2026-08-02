// web/test/settingsPreview.test.jsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/push.js', () => ({
  notifyEnabled: () => false, enableNotifications: vi.fn(), disableNotifications: vi.fn(), pushSupported: () => false,
}));
vi.mock('../src/api.js', () => ({ getPanes: vi.fn(async () => []) }));

import Settings from '../src/components/Settings.jsx';

let container, root;
const termRef = { current: { getFontSize: () => ({ size: 14, auto: false }) } };
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
const render = (props = {}) => act(() => root.render(
  <Settings open onClose={() => {}} termRef={termRef}
    onColAdjust={() => {}} onColRestore={() => {}} onOpenChangelog={() => {}} changelogUnread={false}
    {...props} />));

describe('Settings preview section', () => {
  it('does not duplicate web or static preview controls in app settings', async () => {
    await render();
    expect(container.textContent).not.toContain('网页预览器');
    expect(container.textContent).not.toContain('静态网站预览');
    expect(container.textContent).not.toContain('选择目录启动');
    expect(container.querySelector('.dirpick-card')).toBeNull();
  });
});

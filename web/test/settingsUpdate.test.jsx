import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/push.js', () => ({
  notifyEnabled: () => false, enableNotifications: vi.fn(), disableNotifications: vi.fn(), pushSupported: () => false,
}));
vi.mock('../src/api.js', () => ({ fetchPaneCwd: vi.fn(async () => ({ cwd: '/home/u/proj' })) }));

import Settings from '../src/components/Settings.jsx';

let container; let root;
const termRef = { current: { getFontSize: () => ({ size: 14, auto: false }) } };
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

const render = (whatsNew) => act(() => root.render(
  <Settings open onClose={() => {}} termRef={termRef}
    onColAdjust={() => {}} onColRestore={() => {}} onOpenChangelog={() => {}} changelogUnread={false}
    updateInfo={{ current: '0.17.0', latest: '0.17.4', updateAvailable: true, whatsNew }} />,
));

const releases = [
  { version: '0.17.4', zh: '最新版本', en: 'Latest release' },
  { version: '0.17.3', zh: '上一个版本', en: 'Previous release' },
  { version: '0.17.0', zh: '更早版本', en: 'Earlier release' },
];

describe('Settings update notice', () => {
  it('shows the latest release directly and keeps older releases collapsed until expanded', async () => {
    await render(releases);
    const card = container.querySelector('.settings-update');
    const directList = [...card.children].find((el) => el.matches('ul.settings-update-new'));
    expect(directList.querySelectorAll('li')).toHaveLength(1);
    expect(directList.textContent).toContain('v0.17.4');
    expect(directList.textContent).not.toContain('v0.17.3');

    const more = card.querySelector('details.settings-update-more');
    expect(more.open).toBe(false);
    expect(more.querySelector('summary').textContent).toBe('另有 2 个版本更新');
    expect(more.querySelectorAll('li')).toHaveLength(2);
    await act(() => more.querySelector('summary').click());
    expect(more.open).toBe(true);
  });

  it('does not show an expander when only one release is gained', async () => {
    await render(releases.slice(0, 1));
    expect(container.querySelectorAll('.settings-update-new li')).toHaveLength(1);
    expect(container.querySelector('.settings-update-more')).toBeNull();
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getSessions: vi.fn(),
  getWindows: vi.fn(),
  getPanes: vi.fn(),
  getStates: vi.fn(),
  getOrphans: vi.fn(),
  getServerVersion: vi.fn(),
  getWorkspaceProtectionStatus: vi.fn(),
  getWorkspaceRestorePlan: vi.fn(),
  startWorkspaceRestore: vi.fn(),
  getWorkspaceRestoreOperation: vi.fn(),
}));
const storage = vi.hoisted(() => ({ applyWorkspaceRestoreMapping: vi.fn() }));
const push = vi.hoisted(() => ({ getNotifications: vi.fn() }));

vi.mock('./api.js', async (importOriginal) => ({ ...(await importOriginal()), ...api }));
vi.mock('./storage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  applyWorkspaceRestoreMapping: storage.applyWorkspaceRestoreMapping,
}));
vi.mock('./push.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reportBound: vi.fn(),
  clearPaneNotification: vi.fn(),
  getNotifications: push.getNotifications,
  deleteNotification: vi.fn(async () => {}),
  notifyEnabled: () => false,
  enableNotifications: vi.fn(),
  disableNotifications: vi.fn(),
  pushSupported: () => false,
  getScriptPushKey: vi.fn(async () => null),
}));
vi.mock('./hooks/usePreviews.js', () => ({
  usePreviews: () => ({
    previewDomain: null,
    dynamicEnabled: false,
    previewSheetOpen: false,
    setPreviewSheetOpen: vi.fn(),
    activePreview: null,
    shownPreview: null,
    tabs: [],
    activeName: null,
    openPreviewSheet: vi.fn(),
    startPreview: vi.fn(),
    startDynamicPreview: vi.fn(),
    startUrlPreview: vi.fn(),
    switchTab: vi.fn(),
    closeTab: vi.fn(),
    stopPreview: vi.fn(),
    renewPreview: vi.fn(),
  }),
}));
vi.mock('./useClaudeHooks.js', () => ({ useClaudeHooks: () => ({ status: 'installed', enable: vi.fn() }) }));
vi.mock('./hooks/useBackButton.js', () => ({ useBackButton: () => {} }));
vi.mock('./hooks/useExitConfirm.js', () => ({ useExitConfirm: () => {} }));
vi.mock('./hooks/useKeyboardInset.js', () => ({ useKeyboardInset: () => 0 }));
vi.mock('./hooks/usePageScrollLock.js', () => ({ usePageScrollLock: () => {} }));
vi.mock('./hooks/useLongPress.js', () => ({ useLongPress: () => ({}) }));

vi.mock('./components/WindowBar.jsx', () => ({ default: () => null }));
vi.mock('./components/BottomDock.jsx', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef((_props, _ref) => null) };
});
vi.mock('./components/Terminal.jsx', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(({ pane }, _ref) => <div data-testid="terminal-pane">{pane}</div>) };
});

import App from './App.jsx';
import { getWorkspacePromptState } from './storage.js';

const ACTIVE_SESSION = '10000000-0000-4000-8000-000000000001';
const ACTIVE_WINDOW = '20000000-0000-4000-8000-000000000001';
const ACTIVE_PANE = '30000000-0000-4000-8000-000000000001';

const activePlan = (overrides = {}) => ({
  checkpointId: 'checkpoint-a',
  capturedAt: '2026-07-20T01:42:00.000Z',
  changeReason: 'boot-changed',
  promptEligible: true,
  resolved: false,
  pendingCount: 1,
  summary: { sessions: 1, windows: 1, panes: 2, agents: 0 },
  planSummary: { create: 1, renamed: 0, alreadyPresent: 0, unsupported: 0 },
  sessions: [{
    logicalId: ACTIVE_SESSION,
    sourceName: 'project',
    targetName: 'project-restored',
    action: 'create-renamed',
    activeWindowId: ACTIVE_WINDOW,
    windowLinks: [{ windowId: ACTIVE_WINDOW, index: 0 }],
  }],
  active: { sessionId: ACTIVE_SESSION, windowId: ACTIVE_WINDOW, paneId: ACTIVE_PANE },
  mapping: null,
  ...overrides,
});
const resolvedPlan = (overrides = {}) => activePlan({
  promptEligible: false,
  resolved: true,
  pendingCount: 0,
  planSummary: { create: 0, renamed: 0, alreadyPresent: 0, unsupported: 0 },
  sessions: [],
  ...overrides,
});

const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
    await Promise.resolve();
  });
};

async function renderApp() {
  const view = render(<App />);
  await flush();
  await flush();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((mock) => mock.mockReset());
  storage.applyWorkspaceRestoreMapping.mockReset();
  push.getNotifications.mockReset();
  localStorage.clear();
  localStorage.setItem('tw_lang', 'zh');
  localStorage.setItem('tw_token', 'good');
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network access is forbidden in Task11 tests'); }));

  api.getSessions.mockResolvedValue([]);
  api.getWindows.mockResolvedValue([]);
  api.getPanes.mockResolvedValue([]);
  api.getStates.mockResolvedValue({});
  api.getOrphans.mockResolvedValue([]);
  api.getServerVersion.mockResolvedValue({ current: '0.0.0', latest: '0.0.0', updateAvailable: false });
  api.getWorkspaceProtectionStatus.mockResolvedValue({ status: 'protected', errorCode: null });
  api.getWorkspaceRestorePlan.mockResolvedValue(null);
  api.startWorkspaceRestore.mockResolvedValue({ operationId: 'operation-a', status: 'pending' });
  api.getWorkspaceRestoreOperation.mockResolvedValue({ id: 'operation-a', status: 'pending', progress: { completed: 0, total: 1 }, results: [] });
  push.getNotifications.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App workspace recovery', () => {
  it('shows only a Drawer card when tmux already has a live session', async () => {
    api.getSessions.mockResolvedValue([{ id: '$7', name: 'current' }]);
    api.getWorkspaceRestorePlan.mockResolvedValue(activePlan());
    const { container } = await renderApp();

    expect(container.querySelector('.workspace-recovery-card')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '恢复上次工作区' })).toBeNull();
    expect(getWorkspacePromptState('checkpoint-a')).toEqual({});
  });

  it('auto-opens once for an empty tmux; close only marks autoShown and explicit ignore hides the card', async () => {
    api.getWorkspaceRestorePlan.mockResolvedValue(activePlan());
    const { container } = await renderApp();

    expect(screen.getByRole('dialog', { name: '恢复上次工作区' })).toBeTruthy();
    expect(getWorkspacePromptState('checkpoint-a')).toEqual({ autoShown: true });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await flush();
    expect(screen.queryByRole('dialog', { name: '恢复上次工作区' })).toBeNull();
    expect(container.querySelector('.workspace-recovery-card')).toBeTruthy();
    expect(getWorkspacePromptState('checkpoint-a').ignored).toBeUndefined();

    await flush(15_000);
    expect(screen.queryByRole('dialog', { name: '恢复上次工作区' })).toBeNull();
    fireEvent.click(container.querySelector('.workspace-recovery-card'));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: '忽略此备份' }));
    await flush();
    expect(getWorkspacePromptState('checkpoint-a')).toEqual({ autoShown: true, ignored: true });
    expect(container.querySelector('.workspace-recovery-card')).toBeNull();
  });

  it('applies a mapping even when an expired/resolved plan is hidden', async () => {
    const mapping = { id: 'mapping-from-another-device', runtime: { sessions: { '$1': '$9' } } };
    api.getSessions.mockResolvedValue([{ id: '$9', name: 'project-restored' }]);
    api.getWorkspaceRestorePlan.mockResolvedValue(resolvedPlan({ mapping }));
    const { container } = await renderApp();

    expect(storage.applyWorkspaceRestoreMapping).toHaveBeenCalledWith(mapping);
    expect(container.querySelector('.workspace-recovery-card')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '恢复上次工作区' })).toBeNull();
  });

  it('posts once, reconnects to the same operationId after a failed poll, applies mapping before refresh, and opens the active restored pane', async () => {
    const mapping = {
      id: 'mapping-success',
      names: { project: 'project-restored' },
      runtime: { sessions: { '$1': '$10' }, windows: { '@1': '@10' }, panes: { '%1': '%12' } },
      logical: {
        sessions: { [ACTIVE_SESSION]: '$10' },
        windows: { [ACTIVE_WINDOW]: '@10' },
        panes: { [ACTIVE_PANE]: '%12' },
      },
    };
    api.getWorkspaceRestorePlan
      .mockResolvedValueOnce(activePlan())
      // The refresh may race server plan resolution and briefly return the same
      // eligible checkpoint. A completed operation must still stay dismissed.
      .mockResolvedValueOnce(activePlan());
    api.getSessions
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '$10', name: 'project-restored' }]);
    api.getWindows.mockResolvedValue([{ id: '@10', name: 'main' }]);
    api.getPanes.mockResolvedValue([{ id: '%11', width: 80 }, { id: '%12', width: 80 }]);
    api.getWorkspaceRestoreOperation
      .mockResolvedValueOnce({ id: 'operation-a', status: 'pending', progress: { completed: 0, total: 3 }, results: [] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'operation-a', status: 'running', progress: { completed: 2, total: 3 }, results: [] })
      .mockResolvedValueOnce({
        id: 'operation-a', status: 'succeeded', progress: { completed: 3, total: 3 },
        results: [{ logicalId: ACTIVE_SESSION, sourceName: 'project', targetName: 'project-restored', status: 'restored' }],
        mapping,
      });

    const { container } = await renderApp();
    const restore = screen.getByRole('button', { name: '恢复' });
    fireEvent.click(restore);
    fireEvent.click(restore);
    await flush();
    expect(api.startWorkspaceRestore).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await flush();
    expect(screen.queryByRole('dialog', { name: '恢复上次工作区' })).toBeNull();

    await flush(1_000); // disconnected poll; operationId must be retained
    await flush(1_000); // running 2 / 3
    fireEvent.click(container.querySelector('.workspace-recovery-card'));
    await flush();
    expect(screen.getByText('正在恢复 2 / 3…')).toBeTruthy();
    await flush(1_000); // succeeded

    expect(api.getWorkspaceRestoreOperation).toHaveBeenCalledTimes(4);
    expect(api.getWorkspaceRestoreOperation.mock.calls.every(([id]) => id === 'operation-a')).toBe(true);
    expect(storage.applyWorkspaceRestoreMapping).toHaveBeenCalledWith(mapping);
    expect(storage.applyWorkspaceRestoreMapping.mock.invocationCallOrder[0])
      .toBeLessThan(api.getSessions.mock.invocationCallOrder[1]);
    expect(screen.getByTestId('terminal-pane').textContent).toBe('%12');
    expect(container.querySelector('.workspace-recovery-card')).toBeNull();
  });

  it('keeps the card on partial, enters the first restored session when the active one failed, and shows safe per-session errors', async () => {
    const successId = '10000000-0000-4000-8000-000000000002';
    const failedId = ACTIVE_SESSION;
    const partialPlan = activePlan({
      pendingCount: 2,
      planSummary: { create: 2, renamed: 0, alreadyPresent: 0, unsupported: 0 },
      sessions: [
        { logicalId: successId, sourceName: 'docs', targetName: 'docs', action: 'create', activeWindowId: 'w-docs', windowLinks: [] },
        { logicalId: failedId, sourceName: 'web', targetName: 'web', action: 'create', activeWindowId: ACTIVE_WINDOW, windowLinks: [] },
      ],
      active: { sessionId: failedId, windowId: ACTIVE_WINDOW, paneId: ACTIVE_PANE },
    });
    const mapping = {
      id: 'mapping-partial',
      names: { docs: 'docs' },
      runtime: { sessions: {}, windows: {}, panes: {} },
      logical: { sessions: { [successId]: '$20' }, windows: {}, panes: {} },
    };
    api.getWorkspaceRestorePlan.mockResolvedValueOnce(partialPlan).mockResolvedValueOnce(partialPlan);
    api.getSessions.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: '$20', name: 'docs' }]);
    api.getWindows.mockResolvedValue([{ id: '@20', name: 'docs' }]);
    api.getPanes.mockResolvedValue([{ id: '%20', width: 80 }]);
    api.getWorkspaceRestoreOperation.mockResolvedValueOnce({
      id: 'operation-a', status: 'partial', progress: { completed: 2, total: 2 }, mapping,
      results: [
        { logicalId: successId, sourceName: 'docs', targetName: 'docs', status: 'restored' },
        { logicalId: failedId, sourceName: 'web', status: 'failed', errorCode: 'tmux-unavailable', errorMessage: '/private/secret' },
      ],
    });

    const { container } = await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await flush();
    await flush();

    expect(screen.getByTestId('terminal-pane').textContent).toBe('%20');
    expect(container.querySelector('.workspace-recovery-card')).toBeTruthy();
    expect(screen.getByText(/web：tmux 不可用；请确认 tmux 已运行后重试/)).toBeTruthy();
    expect(screen.queryByText(/private\/secret/)).toBeNull();
  });

  it('hides an idempotent all-already-present success without navigating', async () => {
    api.getWorkspaceRestorePlan.mockResolvedValueOnce(activePlan()).mockResolvedValueOnce(resolvedPlan());
    api.getSessions.mockResolvedValue([]);
    api.getWorkspaceRestoreOperation.mockResolvedValueOnce({
      id: 'operation-a', status: 'succeeded', progress: { completed: 1, total: 1 }, mapping: null,
      results: [{ logicalId: ACTIVE_SESSION, sourceName: 'project', status: 'already-present' }],
    });
    const { container } = await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await flush();
    await flush();
    expect(container.querySelector('.workspace-recovery-card')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '恢复上次工作区' })).toBeNull();
    expect(api.getWindows).not.toHaveBeenCalled();
  });

  it('does not carry a terminal result into a newer checkpoint prompt', async () => {
    const nextPlan = activePlan({ checkpointId: 'checkpoint-b', capturedAt: '2026-07-20T02:42:00.000Z' });
    api.getWorkspaceRestorePlan
      .mockResolvedValueOnce(activePlan())
      .mockResolvedValueOnce(resolvedPlan())
      .mockResolvedValueOnce(nextPlan);
    api.getSessions.mockResolvedValue([]);
    api.getWorkspaceRestoreOperation.mockResolvedValueOnce({
      id: 'operation-a', status: 'succeeded', progress: { completed: 1, total: 1 }, mapping: null,
      results: [{ logicalId: ACTIVE_SESSION, sourceName: 'project', status: 'already-present' }],
    });
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await flush();
    await flush();

    await flush(15_000);
    expect(screen.getByRole('dialog', { name: '恢复上次工作区' })).toBeTruthy();
    expect(screen.queryByText('工作区已恢复。')).toBeNull();
  });

  it('shows a sanitized degraded protection warning in Settings and removes it after protection recovers', async () => {
    api.getWorkspaceRestorePlan.mockRejectedValue(new Error('no checkpoint'));
    api.getWorkspaceProtectionStatus
      .mockResolvedValueOnce({ status: 'degraded', lastSuccessfulCaptureAt: null, errorCode: 'live-corrupt' })
      .mockResolvedValueOnce({ status: 'protected', lastSuccessfulCaptureAt: '2026-07-20T02:00:00.000Z', errorCode: null });
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    await flush();
    expect(screen.getByText('工作区未受保护')).toBeTruthy();
    expect(screen.getByText(/工作区状态副本已损坏/)).toBeTruthy();

    await flush(15_000);
    expect(screen.queryByText('工作区未受保护')).toBeNull();
  });
});

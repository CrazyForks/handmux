import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import WorkspaceRestoreDialog from './WorkspaceRestoreDialog.jsx';
import en from '../i18n/en.js';
import zh from '../i18n/zh.js';
import zhTW from '../i18n/zh-TW.js';
import ja from '../i18n/ja.js';
import ko from '../i18n/ko.js';

const plan = (overrides = {}) => ({
  checkpointId: 'checkpoint-a',
  capturedAt: '2026-07-20T01:42:00.000Z',
  changeReason: 'boot-changed',
  summary: { sessions: 3, windows: 5, panes: 8, agents: 2 },
  planSummary: { create: 1, renamed: 1, alreadyPresent: 1, unsupported: 0 },
  sessions: [
    { logicalId: 'session-api', sourceName: 'api', targetName: 'api', action: 'create' },
    { logicalId: 'session-web', sourceName: 'web', targetName: 'web-restored', action: 'create-renamed' },
    { logicalId: 'session-docs', sourceName: 'docs', action: 'already-present' },
  ],
  ...overrides,
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('WorkspaceRestoreDialog', () => {
  it('shows the checkpoint summary, rename rule, accurate boot reason, and non-destructive promise', () => {
    render(<WorkspaceRestoreDialog open plan={plan()} onClose={() => {}} onIgnore={() => {}} onRestore={() => {}} />);

    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('检测到电脑已重启')).toBeTruthy();
    expect(screen.getByText(/3 个会话 · 5 个窗口 · 8 个窗格/)).toBeTruthy();
    expect(screen.getByText(/将恢复 2 个会话；1 个已经存在/)).toBeTruthy();
    expect(screen.getByText(/web-restored/)).toBeTruthy();
    expect(screen.getByText('当前会话不会被修改、重命名或停止。')).toBeTruthy();
  });

  it('uses tmux-only copy without claiming the computer restarted', () => {
    render(<WorkspaceRestoreDialog open plan={plan({ changeReason: 'tmux-changed' })}
      onClose={() => {}} onIgnore={() => {}} onRestore={() => {}} />);
    expect(screen.getByText('检测到 tmux 已重新启动')).toBeTruthy();
    expect(screen.queryByText('检测到电脑已重启')).toBeNull();
  });

  it('shows honest progress and only localized, per-session terminal failures', () => {
    render(<WorkspaceRestoreDialog open plan={plan()} onClose={() => {}} onIgnore={() => {}} onRestore={() => {}}
      operation={{
        status: 'partial',
        progress: { completed: 2, total: 3 },
        results: [
          { sourceName: 'api', status: 'restored' },
          { sourceName: 'web', status: 'failed', errorCode: 'tmux-unavailable', errorMessage: '/Users/secret must not render' },
        ],
      }} />);
    expect(screen.getByText('已恢复 2 / 3')).toBeTruthy();
    expect(screen.getByText(/web：tmux 不可用；请确认 tmux 已运行后重试/)).toBeTruthy();
    expect(screen.queryByText(/Users\/secret/)).toBeNull();
  });

  it('guards a double tap synchronously before React can commit disabled state', () => {
    const onRestore = vi.fn(() => new Promise(() => {}));
    render(<WorkspaceRestoreDialog open plan={plan()} onClose={() => {}} onIgnore={() => {}} onRestore={onRestore} />);
    const restore = screen.getByRole('button', { name: '恢复' });
    fireEvent.click(restore);
    fireEvent.click(restore);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('ships every workspace key in all five locales without English fallback', () => {
    const workspaceKeys = Object.keys(en).filter((key) => key.startsWith('workspace.')).sort();
    expect(workspaceKeys.length).toBeGreaterThan(20);
    for (const locale of [zh, zhTW, ja, ko]) {
      expect(Object.keys(locale).filter((key) => key.startsWith('workspace.')).sort()).toEqual(workspaceKeys);
    }
  });
});

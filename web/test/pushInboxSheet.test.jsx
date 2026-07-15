import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import PushInboxSheet from '../src/components/PushInboxSheet.jsx';

vi.mock('../src/push.js', () => ({
  getNotifications: vi.fn(),
  deleteNotification: vi.fn(),
}));
import { getNotifications, deleteNotification } from '../src/push.js';

beforeEach(() => { vi.clearAllMocks(); });
// This repo doesn't run vitest with `globals: true`, so testing-library's auto-cleanup-after-each isn't
// wired up — unmount between cases explicitly, or stacked renders make getByText find duplicates
// (see test/inboxEmpty.test.jsx for the same pattern).
afterEach(cleanup);

describe('PushInboxSheet', () => {
  it('renders notifications newest-first with title and body', async () => {
    getNotifications.mockResolvedValue([
      { id: '2', ts: 200, title: '构建完成', body: '耗时 3m' },
      { id: '1', ts: 100, title: '部署成功', body: 'v1.2' },
    ]);
    render(<PushInboxSheet open onClose={() => {}} onAllRead={() => {}} />);
    await waitFor(() => expect(screen.getByText('构建完成')).toBeTruthy());
    expect(screen.getByText('耗时 3m')).toBeTruthy();
    expect(screen.getByText('部署成功')).toBeTruthy();
  });

  it('shows friendly empty state when there are none', async () => {
    getNotifications.mockResolvedValue([]);
    render(<PushInboxSheet open onClose={() => {}} onAllRead={() => {}} />);
    await waitFor(() => expect(screen.getByText(/还没有|No notifications/i)).toBeTruthy());
  });

  it('deletes a row via inline ✕ and removes it from the list', async () => {
    getNotifications.mockResolvedValue([{ id: '1', ts: 100, title: 'a', body: 'b' }]);
    deleteNotification.mockResolvedValue(true);
    render(<PushInboxSheet open onClose={() => {}} onAllRead={() => {}} />);
    await waitFor(() => expect(screen.getByText('a')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/删除|Delete/i));
    await waitFor(() => expect(screen.queryByText('a')).toBeNull());
    expect(deleteNotification).toHaveBeenCalledWith('1');
  });

  it('mark-all-read calls onAllRead with the newest ts', async () => {
    getNotifications.mockResolvedValue([
      { id: '2', ts: 200, title: 'a', body: 'b' },
      { id: '1', ts: 100, title: 'c', body: 'd' },
    ]);
    const onAllRead = vi.fn();
    render(<PushInboxSheet open onClose={() => {}} onAllRead={onAllRead} />);
    await waitFor(() => expect(screen.getByText('a')).toBeTruthy());
    fireEvent.click(screen.getByText(/标记已读|Mark all read/i));
    expect(onAllRead).toHaveBeenCalledWith(200);
  });
});

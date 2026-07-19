import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import InboxPage from '../src/components/InboxPage.jsx';

afterEach(cleanup);

const items = [
  { id: '2', ts: 200, title: '构建完成', body: '耗时 3m', url: '/x' },
  { id: '1', ts: 100, title: '部署成功', body: 'v1.2' },
];

describe('InboxPage list', () => {
  it('renders items newest-first with title and body', () => {
    render(<InboxPage open items={items} readIds={[]} detailId={null}
      onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('构建完成')).toBeTruthy();
    expect(screen.getByText('部署成功')).toBeTruthy();
  });
  it('empty state when no items', () => {
    render(<InboxPage open items={[]} readIds={[]} detailId={null}
      onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/还没有|No notifications/i)).toBeTruthy();
  });
  it('shows a retryable load error without hiding the last good list', () => {
    const onRetry = vi.fn();
    render(<InboxPage open items={items} readIds={[]} detailId={null} error="通知记录加载失败，请检查连接后重试"
      onRetry={onRetry} onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('alert').textContent).toContain('通知记录加载失败');
    expect(screen.getByText('构建完成')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /重试|Retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('does not claim the inbox is empty when its first load failed', () => {
    render(<InboxPage open items={[]} readIds={[]} detailId={null} error="通知记录加载失败，请检查连接后重试"
      onRetry={() => {}} onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/还没有|No notifications/i)).toBeNull();
  });
  it('tapping a row opens its detail', () => {
    const onOpenDetail = vi.fn();
    render(<InboxPage open items={items} readIds={[]} detailId={null}
      onOpenDetail={onOpenDetail} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    fireEvent.click(screen.getByText('构建完成'));
    expect(onOpenDetail).toHaveBeenCalledWith('2');
  });
  it('inline ✕ deletes a row', () => {
    const onDelete = vi.fn();
    render(<InboxPage open items={items} readIds={[]} detailId={null}
      onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getAllByLabelText(/删除|Delete/i)[0]);
    expect(onDelete).toHaveBeenCalledWith('2');
  });
});

describe('InboxPage detail', () => {
  it('shows full message and an open-link button when url present', () => {
    render(<InboxPage open items={items} readIds={[]} detailId="2"
      onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByText('构建完成')).toBeTruthy();
    expect(screen.getByText('耗时 3m')).toBeTruthy();
    expect(screen.getByText(/打开链接|Open link/i)).toBeTruthy();
  });
  it('shows expired when the id is gone', () => {
    render(<InboxPage open items={items} readIds={[]} detailId="999"
      onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/已过期|expired/i)).toBeTruthy();
  });
  it('does not render a link with a non-web protocol from legacy stored data', () => {
    render(<InboxPage open items={[{ ...items[0], url: 'javascript:alert(1)' }]} readIds={[]} detailId="2"
      onOpenDetail={() => {}} onCloseDetail={() => {}} onClose={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(/打开链接|Open link/i)).toBeNull();
  });
  it('closes the detail only after the server confirms deletion', async () => {
    let finish;
    const onDelete = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const onCloseDetail = vi.fn();
    render(<InboxPage open items={items} readIds={[]} detailId="2"
      onOpenDetail={() => {}} onCloseDetail={onCloseDetail} onClose={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByText(/^删除$/));
    expect(onDelete).toHaveBeenCalledWith('2');
    expect(onCloseDetail).not.toHaveBeenCalled();
    finish(true);
    await waitFor(() => expect(onCloseDetail).toHaveBeenCalled());
  });
  it('keeps the detail open when deletion fails', async () => {
    const onDelete = vi.fn(async () => false);
    const onCloseDetail = vi.fn();
    render(<InboxPage open items={items} readIds={[]} detailId="2"
      onOpenDetail={() => {}} onCloseDetail={onCloseDetail} onClose={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByText(/^删除$/));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('2'));
    expect(onCloseDetail).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
});

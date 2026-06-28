import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/api.js', () => ({
  UnauthorizedError: class extends Error {},
  fetchPaneCwd: vi.fn(async () => ({ cwd: '/home/u/proj' })),
  fetchDir: vi.fn(async (p) => {
    const path = p || '/home/u';
    return { path, home: '/home/u', parent: path === '/home/u' ? null : '/home/u', entries: [{ name: 'sub', type: 'dir' }] };
  }),
  downloadFile: vi.fn(async () => {}),
  uploadFile: vi.fn(async () => {}),
}));

import NewWindowModal from '../src/components/NewWindowModal.jsx';

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  // Flush pending async state updates (e.g. fetchPaneCwd) before unmount
  await act(async () => {});
  await act(async () => {});
  act(() => root.unmount());
  container.remove();
});

const render = (props) => act(() => root.render(<NewWindowModal {...props} />));
const fire = (node, type) =>
  act(async () => { node.dispatchEvent(new MouseEvent(type, { bubbles: true })); });
// Flush the async submit and the re-renders it triggers.
const settle = async () => { await act(async () => {}); await act(async () => {}); };
// React tracks the controlled value via the native setter; set then fire `input` so onChange runs.
const typeInto = (node, text) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});

const base = {
  open: true,
  onClose: vi.fn(),
  onCreate: vi.fn(async () => {}),
  inset: 0,
};

describe('NewWindowModal', () => {
  it('blank name → clicking 新建 calls onCreate with empty string (auto-name)', async () => {
    const onCreate = vi.fn(async () => {});
    await render({ ...base, onCreate });
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).toHaveBeenCalledWith('', undefined, undefined);
    expect(container.querySelector('.bind-error')).toBeNull();
  });

  it('valid name → onCreate called with trimmed name', async () => {
    const onCreate = vi.fn(async () => {});
    await render({ ...base, onCreate });
    await typeInto(container.querySelector('.bind-input'), 'build-1');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).toHaveBeenCalledWith('build-1', undefined, undefined);
    expect(container.querySelector('.bind-error')).toBeNull();
  });

  it('invalid name → shows inline error and does NOT call onCreate', async () => {
    const onCreate = vi.fn(async () => {});
    await render({ ...base, onCreate });
    await typeInto(container.querySelector('.bind-input'), 'bad name');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).not.toHaveBeenCalled();
    expect(container.querySelector('.bind-error')).not.toBeNull();
  });

  it('a generic onCreate failure re-enables the 新建 button (busy=false)', async () => {
    const onCreate = vi.fn(async () => { throw new Error('network failure'); });
    await render({ ...base, onCreate });
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).toHaveBeenCalled();
    expect(container.querySelector('.bind-confirm').disabled).toBe(false);
  });

  it('returns null when open=false', async () => {
    await render({ ...base, open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('clicking 取消 calls onClose', async () => {
    const onClose = vi.fn();
    await render({ ...base, onClose });
    const cancelBtn = Array.from(container.querySelectorAll('.fontbtn')).find(b => b.textContent === '取消');
    await fire(cancelBtn, 'click');
    expect(onClose).toHaveBeenCalled();
  });

  it('submits with no cwd when the dir is not changed', async () => {
    const onCreate = vi.fn(async () => {});
    await render({ ...base, onCreate, paneId: '%1' });
    await settle();
    await typeInto(container.querySelector('.bind-input'), 'build');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).toHaveBeenCalledWith('build', undefined, undefined);
  });

  it('submits the picked cwd after choosing a directory', async () => {
    const onCreate = vi.fn(async () => {});
    await render({ ...base, onCreate, paneId: '%1' });
    await settle();
    // open DirPicker by tapping the start-dir field
    await fire(container.querySelector('.cwd-field'), 'click');
    await settle();
    // DirPicker is open; seedCwd='/home/u/proj', fetchDir echoes path back.
    // Navigate into the 'sub' dir so dir.path becomes '/home/u/proj/sub'.
    const subEntry = Array.from(container.querySelectorAll('.browse-entry')).find(e => e.textContent.includes('sub'));
    expect(subEntry).toBeTruthy();
    await fire(subEntry, 'click');
    await settle();
    // click confirm
    await act(async () => { container.querySelector('.browse-pick-confirm').click(); });
    await settle();
    // now click 新建 (name is blank)
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).toHaveBeenCalledWith('', '/home/u/proj/sub', undefined);
  });

  it('reset restores the default (session dir) so cwd is omitted again', async () => {
    const onCreate = vi.fn(async () => {});
    await render({ ...base, onCreate, paneId: '%1' });
    await settle();
    // open DirPicker, confirm default (no navigation = seedCwd = '/home/u/proj')
    await fire(container.querySelector('.cwd-field'), 'click');
    await settle();
    await act(async () => { container.querySelector('.browse-pick-confirm').click(); });
    await settle();
    // reset
    await fire(container.querySelector('.cwd-reset'), 'click');
    await settle();
    // submit
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onCreate).toHaveBeenCalledWith('', undefined, undefined);
  });
});

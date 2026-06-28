import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import RenameModal from '../src/components/RenameModal.jsx';

let container;
let root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (props) => act(() => root.render(<RenameModal {...props} />));
const fire = (node, type) => act(() => { node.dispatchEvent(new MouseEvent(type, { bubbles: true })); });
const settle = async () => { await act(async () => {}); await act(async () => {}); };
// React tracks the controlled value via the native setter; set then fire `input` so onChange runs.
const typeInto = (node, text) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});

const base = {
  open: true, title: '重命名窗口', currentName: 'old', onClose: vi.fn(), onSubmit: vi.fn(async () => {}), inset: 0,
};

describe('RenameModal', () => {
  it('prefills the input with the current name', async () => {
    await render({ ...base });
    expect(container.querySelector('.bind-input').value).toBe('old');
  });

  it('submits the trimmed new name', async () => {
    const onSubmit = vi.fn(async () => {});
    await render({ ...base, onSubmit });
    await typeInto(container.querySelector('.bind-input'), 'build-2');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onSubmit).toHaveBeenCalledWith('build-2');
    expect(container.querySelector('.bind-error')).toBeNull();
  });

  it('rejects a blank or invalid name without calling onSubmit', async () => {
    const onSubmit = vi.fn(async () => {});
    await render({ ...base, onSubmit });
    await typeInto(container.querySelector('.bind-input'), '   ');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    await typeInto(container.querySelector('.bind-input'), 'bad name');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('.bind-error')).not.toBeNull();
  });

  it('shows the thrown error message and re-enables the button on failure', async () => {
    const onSubmit = vi.fn(async () => { throw new Error('该名已存在'); });
    await render({ ...base, onSubmit });
    await fire(container.querySelector('.bind-confirm'), 'click'); // currentName 'old' is valid
    await settle();
    expect(container.querySelector('.bind-error').textContent).toContain('该名已存在');
    expect(container.querySelector('.bind-confirm').disabled).toBe(false);
  });

  it('returns null when open=false', async () => {
    await render({ ...base, open: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('clicking 取消 calls onClose', async () => {
    const onClose = vi.fn();
    await render({ ...base, onClose });
    fire(container.querySelector('.fontbtn'), 'click');
    expect(onClose).toHaveBeenCalled();
  });

  it('Enter key in the input submits a valid name', async () => {
    const onSubmit = vi.fn(async () => {});
    await render({ ...base, onSubmit });
    await typeInto(container.querySelector('.bind-input'), 'build-9');
    await act(async () => {
      container.querySelector('.bind-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    expect(onSubmit).toHaveBeenCalledWith('build-9');
  });
});

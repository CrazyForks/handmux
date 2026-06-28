import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('../src/api.js', () => ({
  getSessions: vi.fn(),
  createSession: vi.fn(),
  UnauthorizedError: class UnauthorizedError extends Error {},
  fetchDir: vi.fn((path) => Promise.resolve({
    path: path ?? '/home/u',
    home: '/home/u',
    parent: path && path !== '/home/u' ? '/home/u' : null,
    entries: [{ name: 'sub', type: 'dir' }],
  })),
  fetchPaneCwd: vi.fn(),
}));

import BindSession from '../src/components/BindSession.jsx';
import { getSessions, createSession, UnauthorizedError, fetchDir } from '../src/api.js';

let container;
let root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const base = {
  open: true,
  bound: [],
  onBound: vi.fn(),
  onClose: vi.fn(),
  onAuthFail: vi.fn(),
};

const render = (props) => act(() => root.render(<BindSession {...base} {...props} />));
const fire = (node, type) => act(async () => { node.dispatchEvent(new MouseEvent(type, { bubbles: true })); });
// Flush the async submit (getSessions/createSession) and the re-renders it triggers.
const settle = async () => { await act(async () => {}); await act(async () => {}); };
// React tracks the controlled value via the native setter; set it then fire `input` so onChange runs.
const typeInto = (node, text) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('BindSession', () => {
  it('binds an existing session directly (no create)', async () => {
    getSessions.mockResolvedValue([{ id: '$0', name: 'main' }]);
    const onBound = vi.fn();
    await render({ onBound });
    typeInto(container.querySelector('.bind-input'), 'main');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onBound).toHaveBeenCalledWith('main');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('offers to create a non-existent valid name, then creates on the second tap', async () => {
    getSessions.mockResolvedValue([{ id: '$0', name: 'main' }]);
    createSession.mockResolvedValue({ id: '$7', name: 'new-sess' });
    const onBound = vi.fn();
    await render({ onBound });
    typeInto(container.querySelector('.bind-input'), 'new-sess');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    // first tap: not found → button flips to create, nothing created/bound yet
    expect(container.querySelector('.bind-confirm').textContent).toBe('新建并打开');
    expect(createSession).not.toHaveBeenCalled();
    expect(onBound).not.toHaveBeenCalled();
    // second tap: create + open
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(createSession).toHaveBeenCalledWith('new-sess', undefined, undefined);
    expect(onBound).toHaveBeenCalledWith('new-sess');
  });

  it('rejects an already-bound name without any network call', async () => {
    const onBound = vi.fn();
    await render({ bound: ['main'], onBound });
    typeInto(container.querySelector('.bind-input'), 'main');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(container.querySelector('.bind-error').textContent).toContain('已绑定');
    expect(getSessions).not.toHaveBeenCalled();
    expect(onBound).not.toHaveBeenCalled();
  });

  it('rejects an invalid new name but still binds an existing spaced name', async () => {
    getSessions.mockResolvedValue([{ id: '$0', name: 'Typeless Session' }]);
    const onBound = vi.fn();
    await render({ onBound });
    // a non-existent name with a space is not creatable → charset error, no create
    typeInto(container.querySelector('.bind-input'), 'bad name');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(container.querySelector('.bind-error')).not.toBeNull();
    expect(createSession).not.toHaveBeenCalled();
    expect(onBound).not.toHaveBeenCalled();
    // but an existing name that contains a space still binds (charset rule is create-only)
    typeInto(container.querySelector('.bind-input'), 'Typeless Session');
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(onBound).toHaveBeenCalledWith('Typeless Session');
  });

  it('on a create failure drops back to bind mode and re-checks (recovers a session the server made)', async () => {
    getSessions.mockResolvedValue([{ id: '$0', name: 'main' }]); // default: new-sess absent
    createSession.mockRejectedValueOnce(new Error('boom'));
    const onBound = vi.fn();
    await render({ onBound });
    typeInto(container.querySelector('.bind-input'), 'new-sess');
    await fire(container.querySelector('.bind-confirm'), 'click'); // first tap → create mode
    await settle();
    await fire(container.querySelector('.bind-confirm'), 'click'); // second tap → create fails
    await settle();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(onBound).not.toHaveBeenCalled();
    const btn = container.querySelector('.bind-confirm');
    expect(btn.disabled).toBe(false);          // busy reset
    expect(btn.textContent).toBe('绑定');        // mode dropped back to bind
    expect(container.querySelector('.bind-error').textContent).toContain('新建失败');
    // retry: the session now exists server-side (the failed create had actually landed) → bind it
    getSessions.mockResolvedValueOnce([{ id: '$0', name: 'main' }, { id: '$7', name: 'new-sess' }]);
    await fire(btn, 'click');
    await settle();
    expect(createSession).toHaveBeenCalledTimes(1); // not called again
    expect(onBound).toHaveBeenCalledWith('new-sess');
  });

  it('calls onAuthFail (no error text) when create hits an auth error', async () => {
    getSessions.mockResolvedValue([{ id: '$0', name: 'main' }]);
    createSession.mockRejectedValueOnce(new UnauthorizedError());
    const onAuthFail = vi.fn();
    const onBound = vi.fn();
    await render({ onAuthFail, onBound });
    typeInto(container.querySelector('.bind-input'), 'new-sess');
    await fire(container.querySelector('.bind-confirm'), 'click'); // → create mode
    await settle();
    await fire(container.querySelector('.bind-confirm'), 'click'); // create → 401
    await settle();
    expect(onAuthFail).toHaveBeenCalled();
    expect(onBound).not.toHaveBeenCalled();
    expect(container.querySelector('.bind-error')).toBeNull();
  });

  it('hides the 起始目录 segment in bind mode', async () => {
    getSessions.mockResolvedValue([{ id: '$0', name: 'main' }]);
    await render({});
    // Before any confirm tap, mode is 'bind' — segment must be absent
    expect(container.textContent).not.toContain('起始目录');
  });

  it('shows the dir segment after a new name arms create, and creates with the picked cwd', async () => {
    getSessions.mockResolvedValue([]);
    createSession.mockResolvedValue({ id: '$7', name: 'newsess' });
    const onBound = vi.fn();
    await render({ onBound });
    typeInto(container.querySelector('.bind-input'), 'newsess');
    await fire(container.querySelector('.bind-confirm'), 'click'); // first tap → create mode
    await settle();
    // Now in create mode — 起始目录 segment visible
    expect(container.textContent).toContain('起始目录');
    // DirPicker not yet open
    expect(container.querySelector('[aria-label="选择目录"]')).toBeNull();
    // Open the picker via the start-dir field
    await fire(container.querySelector('.cwd-field'), 'click');
    await settle();
    // DirPicker should be open now
    expect(container.querySelector('[aria-label="选择目录"]')).not.toBeNull();
    // fetchDir boots with null (home) → entries has 'sub'; navigate into it
    const subEntry = container.querySelector('.browse-entry');
    expect(subEntry.textContent).toContain('sub');
    await fire(subEntry, 'click');
    await settle();
    // Confirm the picked dir
    const confirmPick = container.querySelector('.browse-pick-confirm');
    await fire(confirmPick, 'click');
    await settle();
    // Picker closed, cwd shown
    expect(container.querySelector('[aria-label="选择目录"]')).toBeNull();
    expect(container.textContent).toContain('/home/u/sub');
    // Second confirm — create session
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(createSession).toHaveBeenCalledWith('newsess', '/home/u/sub', undefined);
    expect(onBound).toHaveBeenCalledWith('newsess');
  });

  it('creates with no cwd when the dir is left default', async () => {
    getSessions.mockResolvedValue([]);
    createSession.mockResolvedValue({ id: '$7', name: 'newsess' });
    const onBound = vi.fn();
    await render({ onBound });
    typeInto(container.querySelector('.bind-input'), 'newsess');
    await fire(container.querySelector('.bind-confirm'), 'click'); // first tap → create mode
    await settle();
    expect(container.textContent).toContain('起始目录');
    // Second confirm WITHOUT picking a dir
    await fire(container.querySelector('.bind-confirm'), 'click');
    await settle();
    expect(createSession).toHaveBeenCalledWith('newsess', undefined, undefined);
    expect(onBound).toHaveBeenCalledWith('newsess');
  });
});

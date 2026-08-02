import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const api = vi.hoisted(() => {
  let previews = [];
  return {
    reset() { previews = []; },
    getPreviews: vi.fn(async () => ({ previews: [...previews] })),
    createPreview: vi.fn(async (name, { dir }) => {
      const entry = { name, dir, token: `token-${name}`, expiresAt: Date.now() + 3_600_000 };
      previews = [...previews.filter((item) => item.name !== name), entry];
      return entry;
    }),
    deletePreview: vi.fn(async (name) => {
      previews = previews.filter((item) => item.name !== name);
    }),
  };
});

vi.mock('../src/api.js', () => ({
  getPreviews: api.getPreviews,
  createPreview: api.createPreview,
  deletePreview: api.deletePreview,
  previewUrl: (entry) => `/preview/${entry.name}/?token=${entry.token}`,
}));

import { usePreviews } from '../src/hooks/usePreviews.js';

let container;
let root;
let model;
const current = {
  session: { name: 'dev' },
  window: { id: '@3', name: 'site' },
  paneId: '%8',
};

function Harness() {
  model = usePreviews(current);
  return null;
}

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

beforeEach(async () => {
  localStorage.clear();
  api.reset();
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  await flush();
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
});

describe('usePreviews static tabs', () => {
  const remount = async () => {
    await act(() => root.unmount());
    root = createRoot(container);
    await act(async () => { root.render(<Harness />); });
    await flush();
  };

  it('silently renews an open static tab after remount', async () => {
    await act(async () => { await model.startPreview('/home/u/site'); });
    const name = model.tabs[0].name;
    api.createPreview.mockClear();

    await remount();

    expect(api.createPreview).toHaveBeenCalledWith(name, { dir: '/home/u/site' });
    expect(model.tabs[0].status).toBe('running');
  });

  it('does not resurrect an explicitly stopped preview after remount', async () => {
    await act(async () => { await model.startPreview('/home/u/site'); });
    const name = model.tabs[0].name;
    await act(async () => { await model.stopPreview(name); });
    api.createPreview.mockClear();

    await remount();

    expect(api.createPreview).not.toHaveBeenCalled();
    expect(model.tabs[0]).toMatchObject({ status: 'stopped', keepAlive: false });
  });

  it('keeps tab close device-local while Stop changes the server preview state', async () => {
    await act(async () => { await model.startPreview('/home/u/site'); });
    expect(model.selected).toBe(true);
    expect(model.tabs).toHaveLength(1);
    expect(model.tabs[0]).toMatchObject({ dir: '/home/u/site', status: 'running' });

    const name = model.tabs[0].name;
    act(() => model.closeTab(name));
    expect(model.tabs).toHaveLength(0);
    expect(api.deletePreview).not.toHaveBeenCalled();

    await act(async () => {
      await model.refreshPreviews();
      model.openPreview(name);
    });
    expect(model.tabs).toHaveLength(1);

    await act(async () => { await model.stopPreview(name); });
    expect(api.deletePreview).toHaveBeenCalledWith(name);
    expect(model.tabs[0]).toMatchObject({ status: 'stopped', keepAlive: false });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const api = vi.hoisted(() => {
  return {
    reset() {},
    createPreview: vi.fn(async (name, { dir }) => {
      return { name, dir, url: `/preview/${name}/?token=token-${name}` };
    }),
    deletePreview: vi.fn(async () => {}),
  };
});

vi.mock('../src/api.js', () => ({
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

  it('automatically restores an open static tab after remount', async () => {
    await act(async () => { await model.startPreview('/home/u/site'); });
    const name = model.tabs[0].name;
    api.createPreview.mockClear();

    await remount();

    expect(api.createPreview).toHaveBeenCalledWith(name, { dir: '/home/u/site' });
    expect(model.tabs[0]).toMatchObject({ status: 'ready', url: `/preview/${name}/?token=token-${name}` });
  });

  it('foregrounds by ensuring the lease without a periodic heartbeat', async () => {
    await act(async () => { await model.startPreview('/home/u/site'); });
    const name = model.tabs[0].name;
    api.createPreview.mockClear();

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(api.createPreview).toHaveBeenCalledTimes(1);
    expect(api.createPreview).toHaveBeenCalledWith(name, { dir: '/home/u/site' });
    expect(model.tabs[0].status).toBe('ready');
  });

  it('closes the device tab and releases its server lease together', async () => {
    await act(async () => { await model.startPreview('/home/u/site'); });
    expect(model.selected).toBe(true);
    expect(model.tabs).toHaveLength(1);
    expect(model.tabs[0]).toMatchObject({ dir: '/home/u/site', status: 'ready' });

    const name = model.tabs[0].name;
    await act(async () => { await model.closeTab(name); });
    expect(model.tabs).toHaveLength(0);
    expect(api.deletePreview).toHaveBeenCalledWith(name);
    expect(JSON.parse(localStorage.getItem('hm_static_preview_tabs1'))).toEqual([]);
  });

  it('keeps a failed restored tab and exposes retry with the real error', async () => {
    localStorage.setItem('hm_static_preview_tabs1', JSON.stringify([
      { name: 'dev-site-3', dir: '/home/u/site' },
    ]));
    api.createPreview.mockRejectedValueOnce(new Error('directory not found'));

    await remount();

    expect(model.tabs[0]).toMatchObject({ status: 'error' });
    expect(model.tabs[0].error.message).toBe('directory not found');
    await act(async () => { await model.retryPreview('dev-site-3'); });
    expect(model.tabs[0].status).toBe('ready');
  });
});

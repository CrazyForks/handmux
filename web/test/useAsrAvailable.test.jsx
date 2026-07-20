import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const api = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock('../src/api.js', () => ({ getConfig: api.getConfig }));

import { useAsrAvailable } from '../src/voice/useAsrAvailable.js';

// A tiny probe component that renders the hook's value as text so we can assert on the DOM.
function Probe({ config = null }) {
  const v = useAsrAvailable(config);
  return <span data-x={String(v)}>{String(v)}</span>;
}

let container, root;
beforeEach(() => {
  localStorage.clear();
  api.getConfig.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('useAsrAvailable', () => {
  it('starts unknown with no cache, then reflects the shared app config without fetching', async () => {
    act(() => root.render(<Probe />));
    expect(container.querySelector('span').textContent).toBe('null');
    await act(async () => root.render(<Probe config={{ asr: true }} />));
    expect(container.querySelector('span').textContent).toBe('true');
    expect(localStorage.getItem('tw_asr')).toBe('1');
    expect(api.getConfig).not.toHaveBeenCalled();
  });

  it('reads the localStorage cache as its initial value (no flash for returning installs)', async () => {
    localStorage.setItem('tw_asr', '1');
    await act(async () => root.render(<Probe />));
    expect(container.querySelector('span').textContent).toBe('true');
  });

  it('flips to false and caches 0 when the server reports asr:false', async () => {
    localStorage.setItem('tw_asr', '1');
    await act(async () => root.render(<Probe config={{ asr: false }} />));
    expect(container.querySelector('span').textContent).toBe('false');
    expect(localStorage.getItem('tw_asr')).toBe('0');
  });

  it('keeps the cached value while the shared app config is unavailable', async () => {
    localStorage.setItem('tw_asr', '1');
    await act(async () => root.render(<Probe />));
    expect(container.querySelector('span').textContent).toBe('true');
    expect(api.getConfig).not.toHaveBeenCalled();
  });
});

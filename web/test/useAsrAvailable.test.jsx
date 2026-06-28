import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// Drive /api/config from the test so we can flip availability.
const api = vi.hoisted(() => ({ getConfig: vi.fn() }));
vi.mock('../src/api.js', () => ({ getConfig: api.getConfig }));

import { useAsrAvailable } from '../src/voice/useAsrAvailable.js';

// A tiny probe component that renders the hook's value as text so we can assert on the DOM.
function Probe() {
  const v = useAsrAvailable();
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
  it('starts unknown (null) with no cache, then reflects /api/config', async () => {
    api.getConfig.mockResolvedValue({ asr: true });
    act(() => root.render(<Probe />)); // sync render: effect fires but the fetch promise hasn't resolved
    // initial render before the fetch resolves: cache is empty → null (callers treat as hidden)
    expect(container.querySelector('span').textContent).toBe('null');
    await flush();
    expect(container.querySelector('span').textContent).toBe('true');
    expect(localStorage.getItem('tw_asr')).toBe('1'); // cached for an instant next render
  });

  it('reads the localStorage cache as its initial value (no flash for returning installs)', async () => {
    localStorage.setItem('tw_asr', '1');
    api.getConfig.mockResolvedValue({ asr: true });
    await act(async () => root.render(<Probe />));
    expect(container.querySelector('span').textContent).toBe('true'); // immediate, before fetch
  });

  it('flips to false and caches 0 when the server reports asr:false', async () => {
    localStorage.setItem('tw_asr', '1');
    api.getConfig.mockResolvedValue({ asr: false });
    await act(async () => root.render(<Probe />));
    await flush();
    expect(container.querySelector('span').textContent).toBe('false');
    expect(localStorage.getItem('tw_asr')).toBe('0');
  });

  it('keeps the cached value when the probe fails (transient)', async () => {
    localStorage.setItem('tw_asr', '1');
    api.getConfig.mockRejectedValue(new Error('offline'));
    await act(async () => root.render(<Probe />));
    await flush();
    expect(container.querySelector('span').textContent).toBe('true'); // not yanked
  });
});

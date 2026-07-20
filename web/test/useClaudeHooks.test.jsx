import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '@testing-library/react';

const api = vi.hoisted(() => ({ getConfig: vi.fn(), installClaudeHooks: vi.fn() }));
vi.mock('../src/api.js', () => ({
  getConfig: api.getConfig,
  installClaudeHooks: api.installClaudeHooks,
}));

import { useClaudeHooks } from '../src/useClaudeHooks.js';

beforeEach(() => { localStorage.clear(); api.getConfig.mockReset(); api.installClaudeHooks.mockReset(); });
afterEach(cleanup);

describe('useClaudeHooks', () => {
  it('reads status from the shared app config without fetching it again', async () => {
    const { result, rerender } = renderHook(
      ({ config }) => useClaudeHooks(config),
      { initialProps: { config: null } },
    );
    expect(result.current.status).toBeNull();
    rerender({ config: { claudeHooks: 'absent' } });
    await act(async () => {});
    expect(result.current.status).toBe('absent');
    expect(localStorage.getItem('tw_claude_hooks')).toBe('absent');
    expect(api.getConfig).not.toHaveBeenCalled();
  });
});

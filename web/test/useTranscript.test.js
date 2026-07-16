import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTranscript } from '../src/hooks/useTranscript.js';
import * as api from '../src/api.js';

beforeEach(() => { vi.restoreAllMocks(); });

describe('useTranscript', () => {
  it('polls and returns messages; keeps last on a null (204) poll', async () => {
    const spy = vi.spyOn(api, 'fetchTranscript')
      .mockResolvedValueOnce({ messages: [{ i: 0, role: 'user', type: 'text', text: 'hi' }], hash: 'h1', session: 's' })
      .mockResolvedValue(null); // subsequent polls: unchanged
    const { result } = renderHook(() => useTranscript('%0', true));
    await waitFor(() => expect(result.current.length).toBe(1));
    expect(result.current[0].text).toBe('hi');
    expect(spy).toHaveBeenCalled();
  });

  it('does not poll when disabled', async () => {
    const spy = vi.spyOn(api, 'fetchTranscript').mockResolvedValue(null);
    renderHook(() => useTranscript('%0', false));
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTranscript } from '../src/hooks/useTranscript.js';
import * as api from '../src/api.js';

beforeEach(() => { vi.restoreAllMocks(); });

function makeMsgs(startK, count) {
  return Array.from({ length: count }, (_, idx) => ({
    k: startK + idx, i: startK + idx, role: idx % 2 === 0 ? 'user' : 'assistant', type: 'text', text: `m${startK + idx}`,
  }));
}

describe('useTranscript', () => {
  it('polls the recent window and returns messages; keeps last on a null (204) poll', async () => {
    const recent = makeMsgs(10, 10); // k=10..19
    const spy = vi.spyOn(api, 'fetchTranscript')
      .mockResolvedValueOnce({ messages: recent, hash: 'h1', session: 's', hasMore: true, firstSeq: 10 })
      .mockResolvedValue(null); // subsequent polls: unchanged
    const { result } = renderHook(() => useTranscript('%0', true));
    await waitFor(() => expect(result.current.messages.length).toBe(10));
    expect(result.current.messages[0].text).toBe('m10');
    expect(result.current.hasMoreOlder).toBe(true);
    expect(spy).toHaveBeenCalled();
  });

  it('does not poll when disabled', async () => {
    const spy = vi.spyOn(api, 'fetchTranscript').mockResolvedValue(null);
    renderHook(() => useTranscript('%0', false));
    await new Promise((r) => setTimeout(r, 30));
    expect(spy).not.toHaveBeenCalled();
  });

  it('loadOlder() prepends an older page, deduped/sorted by k', async () => {
    const recent = makeMsgs(10, 10); // k=10..19
    const older = makeMsgs(5, 5); // k=5..9
    const spy = vi.spyOn(api, 'fetchTranscript')
      .mockResolvedValueOnce({ messages: recent, hash: 'h1', session: 's', hasMore: true, firstSeq: 10 })
      .mockResolvedValue(null); // steady-state recent polls: unchanged
    const { result } = renderHook(() => useTranscript('%0', true));
    await waitFor(() => expect(result.current.messages.length).toBe(10));

    spy.mockResolvedValueOnce({ messages: older, session: 's', hasMore: false, firstSeq: 5 });
    await act(async () => { await result.current.loadOlder(); });

    await waitFor(() => expect(result.current.messages.length).toBe(15));
    expect(result.current.messages.map((m) => m.k)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(result.current.hasMoreOlder).toBe(false);

    // the loadOlder call itself must have asked for `before: oldestK` (=10), limit 10
    expect(spy).toHaveBeenCalledWith('%0', expect.objectContaining({ before: 10, limit: 10 }));
  });
});

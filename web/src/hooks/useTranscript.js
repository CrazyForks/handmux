// The 对话 lens's read-projection: poll /api/transcript for the pane's Claude session, hash-gated省流.
// A null poll (204 unchanged) keeps the last messages — same discipline as the terminal loop.
import { useState, useCallback, useEffect, useRef } from 'react';
import { usePollingLoop } from './usePollingLoop.js';
import { fetchTranscript } from '../api.js';

export function useTranscript(pane, enabled) {
  const [messages, setMessages] = useState([]);
  const hashRef = useRef('');

  // Reset the省流 cursor + view whenever the pane changes, so switching panes doesn't briefly show the
  // previous session's messages nor skip re-fetching because a stale hash looks "unchanged".
  useEffect(() => {
    hashRef.current = '';
    setMessages([]);
  }, [pane]);

  const fetch = useCallback(() => fetchTranscript(pane, hashRef.current), [pane]);
  const apply = useCallback((r) => {
    if (!r) return; // 204 / null → keep last
    hashRef.current = r.hash || '';
    setMessages(Array.isArray(r.messages) ? r.messages : []);
  }, []);

  usePollingLoop({ fetch, apply, intervalMs: 1500, enabled: enabled && !!pane, deps: [pane] });
  return messages;
}

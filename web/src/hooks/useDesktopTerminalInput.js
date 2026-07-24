import { useCallback, useEffect, useRef } from 'react';
import { sendInput, UnauthorizedError } from '../api.js';
import { createTerminalInputQueue } from '../terminalInputQueue.js';

export function useDesktopTerminalInput({
  enabled,
  currentPane,
  terminalRef,
  onAuthFail,
  send = sendInput,
}) {
  const queueRef = useRef(null);
  const currentPaneRef = useRef(currentPane);
  const onAuthFailRef = useRef(onAuthFail);
  currentPaneRef.current = currentPane;
  onAuthFailRef.current = onAuthFail;

  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    const queue = createTerminalInputQueue({
      send,
      onDelivered: (pane) => {
        if (!disposed && pane === currentPaneRef.current) terminalRef.current?.wake?.();
      },
      onError: (error, pane) => {
        if (disposed) return;
        if (error instanceof UnauthorizedError) {
          onAuthFailRef.current?.();
        } else if (pane === currentPaneRef.current) {
          terminalRef.current?.inputFailed?.(error);
        }
      },
    });
    queueRef.current = queue;
    return () => {
      disposed = true;
      queueRef.current = null;
      queue.dispose();
    };
  }, [enabled, send, terminalRef]);

  return useCallback((pane, data) => {
    queueRef.current?.enqueue(pane, data);
  }, []);
}

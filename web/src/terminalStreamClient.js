import { getToken } from './storage.js';

const RECONNECT_MS = 1000;

export function terminalStreamEnabled(locationLike = window.location) {
  return new URLSearchParams(locationLike.search).get('terminalStream') === '1';
}

export function openTerminalStream({
  pane,
  onSeed,
  onData,
  onReady,
  onStatus,
  onAuthFail,
  WebSocketCtor = window.WebSocket,
  token = getToken() ?? '',
  reconnectMs = RECONNECT_MS,
}) {
  let socket = null;
  let reconnectTimer = null;
  let closed = false;
  let paused = false;
  let writes = Promise.resolve();

  const send = (message) => {
    if (socket?.readyState === WebSocketCtor.OPEN) socket.send(JSON.stringify(message));
  };

  const connect = () => {
    if (closed || paused) return;
    onStatus?.('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocketCtor(`${protocol}//${window.location.host}/api/terminal-stream`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => send({ type: 'subscribe', token, pane });
    socket.onmessage = (event) => {
      writes = writes.then(async () => {
        if (closed || paused) return;
        if (typeof event.data !== 'string') {
          await onData?.(new Uint8Array(event.data));
          return;
        }
        const message = JSON.parse(event.data);
        if (message.type === 'seed') await onSeed?.(message);
        else if (message.type === 'ready') {
          await onReady?.(message);
          onStatus?.('live');
        }
      }).catch(() => onStatus?.('error'));
    };
    socket.onclose = (event) => {
      socket = null;
      if (closed) return;
      if (event.code === 4001) {
        onAuthFail?.();
        return;
      }
      onStatus?.('reconnecting');
      if (!paused) reconnectTimer = setTimeout(connect, reconnectMs);
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return {
    pause() {
      if (closed || paused) return;
      paused = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      send({ type: 'pause' });
      onStatus?.('paused');
    },
    resync() {
      if (closed) return;
      paused = false;
      if (socket?.readyState === WebSocketCtor.OPEN) {
        onStatus?.('connecting');
        send({ type: 'resync' });
      } else connect();
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { socket?.close(); } catch { /* already closed */ }
      socket = null;
    },
  };
}

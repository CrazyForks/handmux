import { getToken } from './storage.js';

const RECONNECT_MS = 1000;
const CONNECT_TIMEOUT_MS = 3000;

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
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
}) {
  let socket = null;
  let reconnectTimer = null;
  let closed = false;
  let paused = false;
  let writes = Promise.resolve();
  let connectTimer = null;

  const clearConnectTimer = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  };
  const armConnectTimer = (target) => {
    clearConnectTimer();
    connectTimer = setTimeout(() => {
      if (socket === target && target.readyState !== 3) target.close(4000, 'stream timeout');
    }, connectTimeoutMs);
  };

  const send = (message) => {
    if (socket?.readyState === WebSocketCtor.OPEN) socket.send(JSON.stringify(message));
  };

  const connect = () => {
    if (closed || paused) return;
    if (socket && (socket.readyState === 0 || socket.readyState === WebSocketCtor.OPEN)) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    onStatus?.('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const nextSocket = new WebSocketCtor(`${protocol}//${window.location.host}/api/terminal-stream`);
    socket = nextSocket;
    armConnectTimer(nextSocket);
    nextSocket.binaryType = 'arraybuffer';
    nextSocket.onopen = () => {
      if (socket === nextSocket) send({ type: 'subscribe', token, pane });
    };
    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket) return;
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
          clearConnectTimer();
          onStatus?.('live');
        }
      }).catch(() => {
        onStatus?.('error');
        if (socket === nextSocket) nextSocket.close(1003, 'bad stream frame');
      });
    };
    nextSocket.onclose = (event) => {
      if (socket !== nextSocket) return;
      socket = null;
      clearConnectTimer();
      if (closed) return;
      if (event.code === 4001) {
        onAuthFail?.();
        return;
      }
      onStatus?.('reconnecting');
      if (!paused) reconnectTimer = setTimeout(connect, reconnectMs);
    };
    nextSocket.onerror = () => {
      if (socket === nextSocket) nextSocket.close();
    };
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
      clearConnectTimer();
      send({ type: 'pause' });
      onStatus?.('paused');
    },
    resync() {
      if (closed) return;
      paused = false;
      if (socket?.readyState === WebSocketCtor.OPEN) {
        onStatus?.('connecting');
        armConnectTimer(socket);
        send({ type: 'resync' });
      } else connect();
    },
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      clearConnectTimer();
      try { socket?.close(); } catch { /* already closed */ }
      socket = null;
      return writes;
    },
  };
}

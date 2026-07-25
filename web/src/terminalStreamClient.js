import { getToken } from './storage.js';

const RECONNECT_MS = 1000;
const CONNECT_TIMEOUT_MS = 3000;
const MAX_FRAME_LAG_MS = 10000;
const PROBE_INTERVAL_MS = 10000;
const PROBE_TIMEOUT_MS = 5000;

export function openTerminalStream({
  pane,
  onSeed,
  onData,
  onReady,
  onStatus,
  onProbe,
  onAuthFail,
  WebSocketCtor = window.WebSocket,
  token = getToken() ?? '',
  reconnectMs = RECONNECT_MS,
  connectTimeoutMs = CONNECT_TIMEOUT_MS,
  maxFrameLagMs = MAX_FRAME_LAG_MS,
  probeIntervalMs = PROBE_INTERVAL_MS,
  probeTimeoutMs = PROBE_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  let socket = null;
  let subscribedSocket = null;
  let reconnectTimer = null;
  let closed = false;
  let paused = false;
  let writes = Promise.resolve();
  let connectTimer = null;
  let messageEpoch = 0;
  let probeTimer = null;
  let probeTimeout = null;
  let probeId = 0;
  let pendingProbe = null;

  const clearProbe = () => {
    if (probeTimer) clearInterval(probeTimer);
    if (probeTimeout) clearTimeout(probeTimeout);
    probeTimer = null;
    probeTimeout = null;
    pendingProbe = null;
  };

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
  const probe = () => {
    if (closed || paused || !subscribedSocket || pendingProbe) return;
    const id = ++probeId;
    pendingProbe = { id, sentAt: now() };
    send({ type: 'probe', id });
    probeTimeout = setTimeout(() => {
      if (pendingProbe?.id !== id) return;
      pendingProbe = null;
      probeTimeout = null;
      onProbe?.({ ok: false });
    }, probeTimeoutMs);
  };
  const startProbes = () => {
    clearProbe();
    probe();
    probeTimer = setInterval(probe, probeIntervalMs);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const detachSocket = () => {
    const target = socket;
    socket = null;
    if (subscribedSocket === target) subscribedSocket = null;
    clearConnectTimer();
    clearProbe();
    try { target?.close(); } catch { /* already closed */ }
  };

  const connect = () => {
    if (closed || paused) return;
    if (socket && (socket.readyState === 0 || socket.readyState === WebSocketCtor.OPEN)) return;
    clearReconnectTimer();
    onStatus?.('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const nextSocket = new WebSocketCtor(`${protocol}//${window.location.host}/api/terminal-stream`);
    socket = nextSocket;
    armConnectTimer(nextSocket);
    nextSocket.binaryType = 'arraybuffer';
    nextSocket.onopen = () => {
      if (socket !== nextSocket || closed || paused) return;
      subscribedSocket = nextSocket;
      send({ type: 'subscribe', token, pane });
    };
    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket) return;
      let message = null;
      if (typeof event.data === 'string') {
        try { message = JSON.parse(event.data); } catch {
          nextSocket.close(1003, 'bad stream frame');
          return;
        }
        if (message.type === 'probe') {
          if (pendingProbe?.id === message.id) {
            const rttMs = Math.max(0, now() - pendingProbe.sentAt);
            pendingProbe = null;
            if (probeTimeout) clearTimeout(probeTimeout);
            probeTimeout = null;
            onProbe?.({ ok: true, rttMs });
          }
          return;
        }
      }
      const frameEpoch = messageEpoch;
      const queuedAt = Date.now();
      writes = writes.then(async () => {
        if (closed || paused || frameEpoch !== messageEpoch) return;
        if (Date.now() - queuedAt > maxFrameLagMs) {
          messageEpoch += 1;
          detachSocket();
          connect();
          return;
        }
        if (typeof event.data !== 'string') {
          await onData?.(new Uint8Array(event.data));
          return;
        }
        if (message.type === 'seed') await onSeed?.(message);
        else if (message.type === 'ready') {
          await onReady?.(message);
          clearConnectTimer();
          onStatus?.('live');
          startProbes();
        }
      }).catch(() => {
        onStatus?.('error');
        if (socket === nextSocket) nextSocket.close(1003, 'bad stream frame');
      });
    };
    nextSocket.onclose = (event) => {
      if (socket !== nextSocket) return;
      socket = null;
      if (subscribedSocket === nextSocket) subscribedSocket = null;
      clearConnectTimer();
      clearProbe();
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
      messageEpoch += 1;
      clearReconnectTimer();
      clearConnectTimer();
      clearProbe();
      send({ type: 'pause' });
      onStatus?.('paused');
    },
    suspend() {
      if (closed) return writes;
      paused = true;
      messageEpoch += 1;
      clearReconnectTimer();
      detachSocket();
      onStatus?.('paused');
      return writes;
    },
    resync() {
      if (closed) return;
      paused = false;
      messageEpoch += 1;
      if (socket?.readyState === WebSocketCtor.OPEN) {
        onStatus?.('connecting');
        armConnectTimer(socket);
        clearProbe();
        if (subscribedSocket === socket) send({ type: 'resync' });
        else {
          subscribedSocket = socket;
          send({ type: 'subscribe', token, pane });
        }
      } else connect();
    },
    close() {
      closed = true;
      messageEpoch += 1;
      clearReconnectTimer();
      detachSocket();
      return writes;
    },
  };
}

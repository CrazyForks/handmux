import { getToken } from './storage.js';

const RECONNECT_MS = 1000;
const CONNECT_TIMEOUT_MS = 3000;
const MAX_FRAME_LAG_MS = 300;
const MAX_PENDING_DATA_BYTES = 256 * 1024;
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
  maxPendingDataBytes = MAX_PENDING_DATA_BYTES,
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
  let pendingDataBytes = 0;
  let awaitingSeed = true;
  let streamReady = false;
  let queuedDataBatch = null;

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
    pendingDataBytes = 0;
    awaitingSeed = true;
    streamReady = false;
    queuedDataBatch = null;
    clearConnectTimer();
    clearProbe();
    try { target?.close(); } catch { /* already closed */ }
  };

  const requestFreshSeed = () => {
    if (closed || paused || awaitingSeed) return;
    messageEpoch += 1;
    pendingDataBytes = 0;
    awaitingSeed = true;
    streamReady = false;
    queuedDataBatch = null;
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
  };

  const connect = () => {
    if (closed || paused) return;
    if (socket && (socket.readyState === 0 || socket.readyState === WebSocketCtor.OPEN)) return;
    clearReconnectTimer();
    onStatus?.('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const nextSocket = new WebSocketCtor(`${protocol}//${window.location.host}/api/terminal-stream`);
    socket = nextSocket;
    pendingDataBytes = 0;
    awaitingSeed = true;
    streamReady = false;
    queuedDataBatch = null;
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
        // A protocol frame is an ordering boundary. Binary output received after it must not merge
        // into a batch that will be parsed before it.
        queuedDataBatch = null;
        if (awaitingSeed && message.type !== 'seed') return;
        if (message.type === 'seed') {
          awaitingSeed = false;
          streamReady = false;
        }
      } else {
        if (awaitingSeed) return;
        pendingDataBytes += event.data.byteLength;
        if (pendingDataBytes > maxPendingDataBytes) {
          requestFreshSeed();
          return;
        }
        if (queuedDataBatch?.epoch === messageEpoch) {
          queuedDataBatch.chunks.push(event.data);
          queuedDataBatch.byteLength += event.data.byteLength;
          return;
        }
      }
      const frameEpoch = messageEpoch;
      const queuedAt = Date.now();
      const dataBatch = typeof event.data === 'string' ? null : {
        epoch: frameEpoch,
        queuedAt,
        chunks: [event.data],
        byteLength: event.data.byteLength,
      };
      if (dataBatch) queuedDataBatch = dataBatch;
      writes = writes.then(async () => {
        if (dataBatch && queuedDataBatch === dataBatch) queuedDataBatch = null;
        if (closed || paused || frameEpoch !== messageEpoch) return;
        pendingDataBytes = Math.max(0, pendingDataBytes - (dataBatch?.byteLength ?? 0));
        if (streamReady && dataBatch && Date.now() - dataBatch.queuedAt > maxFrameLagMs) {
          requestFreshSeed();
          return;
        }
        if (dataBatch) {
          if (dataBatch.chunks.length === 1) {
            await onData?.(new Uint8Array(dataBatch.chunks[0]));
            return;
          }
          const joined = new Uint8Array(dataBatch.byteLength);
          let offset = 0;
          for (const chunk of dataBatch.chunks) {
            const bytes = new Uint8Array(chunk);
            joined.set(bytes, offset);
            offset += bytes.byteLength;
          }
          await onData?.(joined);
          return;
        }
        if (message.type === 'seed') await onSeed?.(message);
        else if (message.type === 'ready') {
          await onReady?.(message);
          streamReady = true;
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
      pendingDataBytes = 0;
      awaitingSeed = true;
      streamReady = false;
      queuedDataBatch = null;
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
      pendingDataBytes = 0;
      awaitingSeed = true;
      streamReady = false;
      queuedDataBatch = null;
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
      pendingDataBytes = 0;
      streamReady = false;
      queuedDataBatch = null;
      clearReconnectTimer();
      detachSocket();
      return writes;
    },
  };
}

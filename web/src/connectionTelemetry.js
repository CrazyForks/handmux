const RATE_WINDOW_MS = 3000;
const DEGRADE_AFTER_MS = 15000;
const RECOVER_AFTER_MS = 60000;

const QUALITY_RANK = {
  connecting: -1,
  good: 0,
  degraded: 1,
  poor: 2,
};

export function classifyConnectionSample({ ok, rttMs }) {
  if (!ok) return 'poor';
  if (!Number.isFinite(rttMs)) return 'connecting';
  if (rttMs >= 1500) return 'poor';
  if (rttMs >= 500) return 'degraded';
  return 'good';
}

export function formatReceiveRate(bytesPerSecond) {
  const value = Math.max(0, Number(bytesPerSecond) || 0);
  if (value < 1024) return `${Math.round(value)} B/s`;
  if (value < 1024 * 1024) {
    const kb = value / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB/s`;
  }
  const mb = value / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB/s`;
}

export function payloadBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export function createConnectionTelemetry({
  mode,
  onChange,
  now = () => Date.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let disposed = false;
  let pendingQuality = null;
  let pendingSince = 0;
  let traffic = [];
  let state = {
    mode,
    quality: 'connecting',
    rttMs: null,
    bytesPerSecond: 0,
  };

  const emit = () => {
    if (!disposed) onChange?.({ ...state });
  };
  const updateRate = () => {
    const cutoff = now() - RATE_WINDOW_MS;
    traffic = traffic.filter((item) => item.at > cutoff);
    const bytes = traffic.reduce((sum, item) => sum + item.bytes, 0);
    const bytesPerSecond = Math.round(bytes * 1000 / RATE_WINDOW_MS);
    if (bytesPerSecond !== state.bytesPerSecond) {
      state = { ...state, bytesPerSecond };
      emit();
    }
  };
  const addTraffic = (bytes) => {
    const amount = Math.max(0, Number(bytes) || 0);
    if (!amount || disposed) return;
    traffic.push({ at: now(), bytes: amount });
  };
  const applyQuality = (quality, immediate = false) => {
    if (quality === 'connecting') {
      if (state.quality === 'connecting') emit();
      return;
    }
    if (quality === state.quality) {
      pendingQuality = null;
      pendingSince = 0;
      emit();
      return;
    }
    if (state.quality === 'connecting' && quality === 'poor' && !immediate) {
      pendingQuality = 'poor';
      pendingSince = now();
      state = { ...state, quality: 'degraded' };
      emit();
      return;
    }
    if (state.quality === 'connecting' || immediate) {
      pendingQuality = null;
      pendingSince = 0;
      state = { ...state, quality };
      emit();
      return;
    }
    const waitMs = QUALITY_RANK[quality] > QUALITY_RANK[state.quality]
      ? DEGRADE_AFTER_MS
      : RECOVER_AFTER_MS;
    if (pendingQuality !== quality) {
      pendingQuality = quality;
      pendingSince = now();
      emit();
      return;
    }
    if (now() - pendingSince >= waitMs) {
      pendingQuality = null;
      pendingSince = 0;
      state = { ...state, quality };
    }
    emit();
  };

  const interval = setIntervalFn(updateRate, 1000);
  emit();

  return {
    traffic: addTraffic,
    sample({ ok, rttMs, bytes = 0 }) {
      if (disposed) return;
      addTraffic(bytes);
      if (Number.isFinite(rttMs)) state = { ...state, rttMs: Math.max(0, Math.round(rttMs)) };
      applyQuality(classifyConnectionSample({ ok, rttMs }));
      updateRate();
    },
    status(status) {
      if (disposed) return;
      if (status === 'reconnecting' || status === 'error') applyQuality('degraded', true);
      else if (status === 'connecting' && state.rttMs == null) {
        state = { ...state, quality: 'connecting' };
        emit();
      }
    },
    setMode(nextMode, { fallback = false } = {}) {
      if (disposed || state.mode === nextMode) return;
      state = { ...state, mode: nextMode };
      if (fallback) state.quality = 'degraded';
      emit();
    },
    getSnapshot() {
      updateRate();
      return { ...state };
    },
    destroy() {
      disposed = true;
      clearIntervalFn(interval);
      traffic = [];
    },
  };
}

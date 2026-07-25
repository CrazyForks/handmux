const DEGRADE_AFTER_MS = 15000;
const RECOVER_AFTER_MS = 30000;

const QUALITY_RANK = {
  connecting: -1,
  good: 0,
  degraded: 1,
  poor: 2,
};

export function classifyConnectionSample({ ok, rttMs }) {
  if (!ok) return 'poor';
  if (!Number.isFinite(rttMs)) return 'connecting';
  if (rttMs > 1000) return 'poor';
  if (rttMs >= 300) return 'degraded';
  return 'good';
}

export function createConnectionTelemetry({
  mode,
  onChange,
  now = () => Date.now(),
}) {
  let disposed = false;
  let pendingQuality = null;
  let pendingSince = 0;
  let state = {
    mode,
    quality: 'connecting',
    rttMs: null,
  };

  const emit = () => {
    if (!disposed) onChange?.({ ...state });
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

  emit();

  return {
    sample({ ok, rttMs }) {
      if (disposed) return;
      if (Number.isFinite(rttMs)) state = { ...state, rttMs: Math.max(0, Math.round(rttMs)) };
      applyQuality(classifyConnectionSample({ ok, rttMs }));
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
      return { ...state };
    },
    peek() {
      return { ...state };
    },
    destroy() {
      disposed = true;
    },
  };
}

import { rubberBand } from './dockKeyboard.js';

export const HISTORY_PULL_THRESHOLD_PX = 72;
export const HISTORY_WHEEL_IDLE_MS = 150;

export function createTerminalHistoryPullController({
  atTop,
  canLoad,
  onChange,
  onLoad,
}) {
  let source = null;
  let pull = 0;
  let loading = false;
  let wheelTimer = null;
  let disposed = false;

  const clearWheelTimer = () => {
    if (wheelTimer == null) return;
    clearTimeout(wheelTimer);
    wheelTimer = null;
  };

  const emit = (phase, offset = 0) => {
    if (!disposed) onChange?.(phase ? { phase, offset } : null);
  };

  const reset = () => {
    clearWheelTimer();
    source = null;
    pull = 0;
    emit(null);
  };

  const commit = () => {
    clearWheelTimer();
    if (loading || pull < HISTORY_PULL_THRESHOLD_PX) {
      reset();
      return;
    }
    loading = true;
    source = null;
    emit('loading', rubberBand(pull));
    let load;
    try {
      load = onLoad?.();
    } catch (error) {
      load = Promise.reject(error);
    }
    Promise.resolve(load)
      .catch(() => {})
      .finally(() => {
        if (disposed) return;
        loading = false;
        reset();
      });
  };

  const move = (nextSource, delta) => {
    if (loading) return true;
    if (source && source !== nextSource) reset();
    if (delta <= 0) {
      if (!source) return false;
      reset();
      return false;
    }
    if (!source) {
      if (!atTop() || !canLoad()) return false;
      source = nextSource;
    }
    pull += delta;
    emit(
      pull >= HISTORY_PULL_THRESHOLD_PX ? 'armed' : 'pulling',
      rubberBand(pull),
    );
    return true;
  };

  return {
    beginTouch() {
      if (!loading) reset();
    },
    moveTouch(delta) {
      return move('touch', delta);
    },
    endTouch() {
      if (source !== 'touch') return loading;
      const consumed = true;
      commit();
      return consumed;
    },
    wheel(delta) {
      const consumed = move('wheel', delta);
      if (!consumed || loading) return consumed;
      clearWheelTimer();
      wheelTimer = setTimeout(commit, HISTORY_WHEEL_IDLE_MS);
      return true;
    },
    cancel() {
      if (!loading) reset();
    },
    dispose() {
      disposed = true;
      clearWheelTimer();
    },
  };
}

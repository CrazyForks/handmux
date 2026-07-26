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
  let wheelLocked = false;
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
    wheelLocked = false;
    source = null;
    pull = 0;
    emit(null);
  };

  const armWheelRelease = () => {
    clearWheelTimer();
    wheelTimer = setTimeout(() => {
      wheelTimer = null;
      wheelLocked = false;
      if (!loading) reset();
    }, HISTORY_WHEEL_IDLE_MS);
  };

  const commit = () => {
    clearWheelTimer();
    if (loading || pull < HISTORY_PULL_THRESHOLD_PX) {
      reset();
      return;
    }
    const wheelLoad = source === 'wheel';
    loading = true;
    wheelLocked = wheelLoad;
    source = null;
    emit('loading', rubberBand(pull));
    if (wheelLoad) armWheelRelease();
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
        pull = 0;
        emit(null);
        if (!wheelLocked) reset();
      });
  };

  const move = (nextSource, delta) => {
    if (loading || wheelLocked) return true;
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
      if (!consumed) return false;
      if (loading || wheelLocked) {
        armWheelRelease();
        return true;
      }
      if (pull >= HISTORY_PULL_THRESHOLD_PX) commit();
      else armWheelRelease();
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

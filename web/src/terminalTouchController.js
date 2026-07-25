import { scrollPane, sendKeys } from './api.js';
import { shouldKeepKeyboard } from './dockKeyboard.js';
import { drainWheel, notchDir } from './wheelScroll.js';
import { flingStep, shouldFling } from './momentum.js';
import { scrollDecision } from './terminalViewport.js';
import { setFont } from './storage.js';

const WHEEL_PX = 22;
const FORWARDED_WHEEL_PX = 12;

export function createTerminalTouchController({
  term,
  host,
  desktop,
  pane,
  fontRef,
  selection,
  selectionActiveRef,
  stopFlingRef,
  getStreamExact,
  getAltScreen,
  getMouseAware,
  onActivity,
  onUserScroll,
  armHistoryPull,
  showScrollPosition,
  maybePullMore,
  scheduleFit,
  wake,
  onTap,
}) {
  const buffer = () => term.buffer.active;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let axis = 0;
  let pinching = false;
  let initialPinchDistance = 0;
  let initialPinchFont = 0;
  let selecting = false;
  let selectionOnDown = false;
  let longPressTimer = null;
  let lastMoveX = 0;
  let lastMoveY = 0;
  let lastMoveTime = 0;
  let scrollVelocityX = 0;
  let scrollVelocityY = 0;
  let flingRAF = null;
  let wheelAccum = 0;
  let wheelPreviousY = 0;
  let wheelPending = 0;
  let wheelBusy = false;
  let lastWheelTime = 0;

  const cancelLongPress = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };
  const touchDistance = (touches) => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
  const stopFling = () => {
    if (flingRAF != null) {
      cancelAnimationFrame(flingRAF);
      flingRAF = null;
    }
  };
  stopFlingRef.current = stopFling;

  const startFling = (element, property, initialVelocity) => {
    if (!element) return;
    let velocity = initialVelocity;
    let previousTime = null;
    const frame = (time) => {
      if (previousTime == null) {
        previousTime = time;
        flingRAF = requestAnimationFrame(frame);
        return;
      }
      const step = flingStep(velocity, time - previousTime);
      previousTime = time;
      velocity = step.v;
      const before = element[property];
      element[property] = before + step.delta;
      const hitEdge = Math.abs(step.delta) >= 1 && element[property] === before;
      if (property === 'scrollTop') {
        showScrollPosition();
        maybePullMore();
      }
      if (step.done || hitEdge || flingRAF == null) {
        flingRAF = null;
        return;
      }
      flingRAF = requestAnimationFrame(frame);
    };
    flingRAF = requestAnimationFrame(frame);
  };

  const flushWheel = async () => {
    if (wheelBusy || wheelPending === 0) return;
    wheelBusy = true;
    const direction = notchDir(wheelPending);
    const count = Math.min(Math.abs(wheelPending), 40);
    wheelPending = 0;
    try {
      if (getMouseAware()) await scrollPane(pane, direction, count);
      else await sendKeys(pane, Array(count).fill(direction === 'up' ? 'Up' : 'Down'));
      wake();
    } catch {
      // A later gesture can retry after a transient network failure.
    } finally {
      wheelBusy = false;
      if (wheelPending !== 0) flushWheel();
    }
  };

  const onTouchStart = (event) => {
    onActivity();
    cancelLongPress();
    stopFling();
    armHistoryPull();
    selectionOnDown = selectionActiveRef.current;
    selecting = false;
    if (event.touches.length === 2) {
      pinching = true;
      axis = -1;
      initialPinchDistance = touchDistance(event.touches);
      initialPinchFont = term.options.fontSize || 14;
      return;
    }
    pinching = false;
    if (event.touches.length !== 1) {
      axis = -1;
      return;
    }
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startLeft = host.scrollLeft;
    axis = 0;
    lastMoveX = startX;
    lastMoveY = startY;
    lastMoveTime = event.timeStamp;
    scrollVelocityX = 0;
    scrollVelocityY = 0;
    wheelPreviousY = startY;
    wheelAccum = 0;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      selecting = true;
      axis = -1;
      selection.start(startX, startY);
    }, 500);
  };

  const onTouchMove = (event) => {
    if (pinching && event.touches.length === 2) {
      if (initialPinchDistance > 0) {
        const fontSize = Math.max(8, Math.min(
          40,
          Math.round(initialPinchFont * (touchDistance(event.touches) / initialPinchDistance)),
        ));
        if (fontSize !== (term.options.fontSize || 14)) {
          term.options.fontSize = fontSize;
          fontRef.current = fontSize;
        }
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (selecting && event.touches.length === 1) {
      selection.extend(event.touches[0].clientX, event.touches[0].clientY);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.touches.length === 1) {
      showScrollPosition();
      maybePullMore();
    }
    if (event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) cancelLongPress();
    if (axis === 0) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 1 : -1;
    }
    if (axis === 1) {
      host.scrollLeft = startLeft - dx;
      const x = event.touches[0].clientX;
      const elapsed = event.timeStamp - lastMoveTime;
      if (elapsed > 0) scrollVelocityX = (lastMoveX - x) / elapsed;
      lastMoveX = x;
      lastMoveTime = event.timeStamp;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const y = event.touches[0].clientY;
    const stepY = y - wheelPreviousY;
    wheelPreviousY = y;
    if (getStreamExact()) {
      event.preventDefault();
      event.stopPropagation();
      const before = host.scrollTop;
      host.scrollTop -= stepY;
      if (host.scrollTop !== before) {
        onUserScroll();
        return;
      }
      if (!getAltScreen()) {
        const viewport = host.querySelector('.xterm-viewport');
        if (viewport) viewport.scrollTop -= stepY;
        showScrollPosition();
        maybePullMore();
        return;
      }
    }
    if (getAltScreen()) {
      event.preventDefault();
      event.stopPropagation();
      const viewport = host.querySelector('.xterm-viewport');
      const direction = stepY > 0 ? -1 : 1;
      if (viewport && scrollDecision(
        buffer().viewportY,
        buffer().baseY,
        direction,
      ) === 'internal') {
        viewport.scrollTop -= stepY;
        onUserScroll();
        return;
      }
      const drained = drainWheel(wheelAccum + stepY, FORWARDED_WHEEL_PX);
      wheelAccum = drained.rem;
      if (drained.notches) {
        wheelPending += drained.notches;
        flushWheel();
      }
      return;
    }
    const elapsed = event.timeStamp - lastMoveTime;
    if (elapsed > 0) scrollVelocityY = (lastMoveY - y) / elapsed;
    lastMoveY = y;
    lastMoveTime = event.timeStamp;
  };

  const onTouchEnd = (event) => {
    cancelLongPress();
    if (selecting && event.touches.length === 0) {
      selecting = false;
      const text = term.getSelection();
      if (text && text.trim()) selection.refresh();
      else selection.clear();
      return;
    }
    if (pinching && event.touches.length < 2) {
      pinching = false;
      setFont(term.options.fontSize || 14);
      scheduleFit();
      return;
    }
    if (event.touches.length === 0 && shouldFling(
      axis === 1 ? scrollVelocityX : scrollVelocityY,
      event.timeStamp - lastMoveTime,
    )) {
      if (axis === 1) startFling(host, 'scrollLeft', scrollVelocityX);
      else if (axis === -1) {
        startFling(host.querySelector('.xterm-viewport'), 'scrollTop', scrollVelocityY);
      }
    }
    if (event.touches.length === 0 && !selecting && !pinching && axis === 0) {
      if (selectionOnDown) selection.clear();
      else onTap();
    }
  };

  const onWheel = (event) => {
    if (!event.deltaY) return;
    if (getStreamExact()) {
      const before = host.scrollTop;
      host.scrollTop += event.deltaY;
      if (host.scrollTop !== before) {
        event.preventDefault();
        event.stopPropagation();
        onUserScroll();
        return;
      }
    }
    if (getAltScreen()) {
      event.preventDefault();
      event.stopPropagation();
      const pixels = event.deltaMode === 1
        ? event.deltaY * WHEEL_PX
        : event.deltaMode === 2
          ? event.deltaY * term.rows * WHEEL_PX
          : event.deltaY;
      const drained = drainWheel(wheelAccum - pixels, WHEEL_PX);
      wheelAccum = drained.rem;
      if (drained.notches) {
        wheelPending += drained.notches;
        flushWheel();
      }
      return;
    }
    if (event.timeStamp - lastWheelTime > 200) armHistoryPull();
    lastWheelTime = event.timeStamp;
    showScrollPosition();
    maybePullMore();
  };

  const onPointerDown = (event) => {
    if (desktop) {
      onTap();
      return;
    }
    if (shouldKeepKeyboard(document.activeElement) && event.cancelable) event.preventDefault();
  };

  host.addEventListener('pointerdown', onPointerDown, { capture: true });
  host.addEventListener('wheel', onWheel, { capture: true, passive: false });
  host.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  host.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  host.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });

  return {
    dispose() {
      cancelLongPress();
      stopFling();
      host.removeEventListener('pointerdown', onPointerDown, { capture: true });
      host.removeEventListener('wheel', onWheel, { capture: true });
      host.removeEventListener('touchstart', onTouchStart, { capture: true });
      host.removeEventListener('touchmove', onTouchMove, { capture: true });
      host.removeEventListener('touchend', onTouchEnd, { capture: true });
    },
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTerminalHistoryPullController,
  HISTORY_PULL_THRESHOLD_PX,
  HISTORY_WHEEL_IDLE_MS,
} from '../src/terminalHistoryPullController.js';

function setup(overrides = {}) {
  const changes = [];
  const onLoad = vi.fn();
  const controller = createTerminalHistoryPullController({
    atTop: () => true,
    canLoad: () => true,
    onChange: (next) => changes.push(next),
    onLoad,
    ...overrides,
  });
  return { controller, changes, onLoad };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('terminal history pull controller', () => {
  it('does not load a short touch pull', () => {
    const { controller, changes, onLoad } = setup();
    controller.beginTouch();
    expect(controller.moveTouch(HISTORY_PULL_THRESHOLD_PX - 1)).toBe(true);
    expect(changes.at(-1)?.phase).toBe('pulling');
    expect(controller.endTouch()).toBe(true);
    expect(onLoad).not.toHaveBeenCalled();
    expect(changes.at(-1)).toBeNull();
  });

  it('loads once after an armed touch gesture ends', () => {
    const { controller, changes, onLoad } = setup();
    controller.beginTouch();
    controller.moveTouch(HISTORY_PULL_THRESHOLD_PX);
    expect(changes.at(-1)?.phase).toBe('armed');
    expect(onLoad).not.toHaveBeenCalled();
    controller.endTouch();
    expect(onLoad).toHaveBeenCalledOnce();
    expect(changes.some((next) => next?.phase === 'loading')).toBe(true);
  });

  it('loads immediately at the wheel threshold and treats one burst as one page', async () => {
    vi.useFakeTimers();
    let resolveLoad;
    const onLoad = vi.fn(() => new Promise((resolve) => { resolveLoad = resolve; }));
    const { controller } = setup({ onLoad });

    expect(controller.wheel(HISTORY_PULL_THRESHOLD_PX / 2)).toBe(true);
    expect(onLoad).not.toHaveBeenCalled();
    expect(controller.wheel(HISTORY_PULL_THRESHOLD_PX / 2)).toBe(true);
    expect(onLoad).toHaveBeenCalledOnce();

    expect(controller.wheel(HISTORY_PULL_THRESHOLD_PX)).toBe(true);
    await vi.advanceTimersByTimeAsync(HISTORY_WHEEL_IDLE_MS);
    expect(onLoad).toHaveBeenCalledOnce();
    resolveLoad();
    await vi.runAllTimersAsync();
  });

  it('drops a short wheel pull after the burst ends', async () => {
    vi.useFakeTimers();
    const { controller, changes, onLoad } = setup();
    controller.wheel(HISTORY_PULL_THRESHOLD_PX - 1);
    expect(changes.at(-1)?.phase).toBe('pulling');
    await vi.advanceTimersByTimeAsync(HISTORY_WHEEL_IDLE_MS);
    expect(changes.at(-1)).toBeNull();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('absorbs the rest of a wheel burst after a fast load completes', async () => {
    vi.useFakeTimers();
    const { controller, onLoad } = setup();
    controller.wheel(HISTORY_PULL_THRESHOLD_PX);
    await Promise.resolve();
    await Promise.resolve();

    controller.wheel(HISTORY_PULL_THRESHOLD_PX);
    expect(onLoad).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(HISTORY_WHEEL_IDLE_MS);

    controller.wheel(HISTORY_PULL_THRESHOLD_PX);
    expect(onLoad).toHaveBeenCalledTimes(2);
  });

  it('cancels an active pull when direction reverses', () => {
    const { controller, changes, onLoad } = setup();
    controller.beginTouch();
    controller.moveTouch(HISTORY_PULL_THRESHOLD_PX);
    expect(controller.moveTouch(-1)).toBe(false);
    expect(changes.at(-1)).toBeNull();
    controller.endTouch();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('leaves ordinary scrolling alone before the viewport reaches the top', () => {
    const { controller, onLoad } = setup({ atTop: () => false });
    expect(controller.moveTouch(HISTORY_PULL_THRESHOLD_PX)).toBe(false);
    expect(controller.wheel(HISTORY_PULL_THRESHOLD_PX)).toBe(false);
    expect(onLoad).not.toHaveBeenCalled();
  });
});

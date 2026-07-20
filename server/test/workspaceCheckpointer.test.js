import { describe, expect, it, vi } from 'vitest';
import { createCheckpointer, createGracefulShutdown } from '../src/workspace/checkpointer.js';

const oldEnvironment = { id: 'env-old', bootIdentity: 'boot-old', tmuxServerId: 'tmux-old' };
const newEnvironment = { id: 'env-new', bootIdentity: 'boot-new', tmuxServerId: 'tmux-new' };

function snapshot(environment, capturedAt = '2026-07-20T10:00:00.000Z', empty = false) {
  if (empty) return {
    schemaVersion: 1, capturedAt, environment, tmuxVersion: '3.6a', active: null, sessions: [], windows: [],
  };
  return {
    schemaVersion: 1,
    capturedAt,
    environment,
    tmuxVersion: '3.6a',
    active: { sessionId: 's-a', windowId: 'w-a', paneId: 'p-a' },
    sessions: [{ id: 's-a', runtimeId: '$1', name: 'dev', windowLinks: [{ windowId: 'w-a', index: 0 }], activeWindowId: 'w-a' }],
    windows: [{ id: 'w-a', runtimeId: '@1', name: 'main', index: 0, layout: 'layout', activePaneId: 'p-a', panes: [{ id: 'p-a', runtimeId: '%1', index: 0, cwd: '/work', agent: null }] }],
  };
}

function deps(overrides = {}) {
  const release = vi.fn(async () => {});
  return {
    store: {
      readLive: vi.fn(async () => ({ status: 'empty' })),
      writeLive: vi.fn(async () => {}),
      archiveEnvironment: vi.fn(async () => ({ status: 'ok' })),
    },
    capture: vi.fn(async (environment) => ({ status: 'ok', snapshot: snapshot(environment) })),
    observeEnvironment: vi.fn(async () => newEnvironment),
    lock: { tryAcquire: vi.fn(async () => ({ owner: {}, release })) },
    now: () => Date.parse('2026-07-20T12:00:00.000Z'),
    setInterval: vi.fn(() => ({ kind: 'interval' })),
    clearInterval: vi.fn(),
    setTimeout: vi.fn(() => ({ kind: 'timeout' })),
    clearTimeout: vi.fn(),
    ...overrides,
  };
}

describe('workspace checkpointer', () => {
  it('starts with an immediate reconcile and a 60 second interval', async () => {
    const d = deps({ capture: vi.fn(async () => ({ status: 'unknown' })) });
    const checkpointer = createCheckpointer(d);

    await checkpointer.start();

    expect(d.setInterval).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(d.capture).toHaveBeenCalledOnce();
  });

  it('debounces mutation and hook events for 2 seconds', () => {
    const d = deps();
    const checkpointer = createCheckpointer(d);

    checkpointer.requestReconcile();
    checkpointer.requestReconcile();

    expect(d.clearTimeout).toHaveBeenCalledTimes(2);
    expect(d.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2_000);
  });

  it('does zero writes when the canonical fingerprint is unchanged', async () => {
    const before = snapshot(newEnvironment, '2026-07-20T10:00:00.000Z');
    const after = snapshot(newEnvironment, '2026-07-20T12:00:00.000Z');
    const d = deps({
      store: {
        readLive: vi.fn(async () => ({ status: 'ok', value: before })),
        writeLive: vi.fn(),
        archiveEnvironment: vi.fn(),
      },
      capture: vi.fn(async () => ({ status: 'ok', snapshot: after })),
    });

    await createCheckpointer(d).reconcile('timer');

    expect(d.store.writeLive).not.toHaveBeenCalled();
    expect(d.store.archiveEnvironment).not.toHaveBeenCalled();
  });

  it('never overwrites live state when environment observation or capture is unknown', async () => {
    const live = snapshot(oldEnvironment);
    for (const failed of ['observe', 'capture']) {
      const d = deps({
        store: {
          readLive: vi.fn(async () => ({ status: 'ok', value: live })),
          writeLive: vi.fn(),
          archiveEnvironment: vi.fn(),
        },
        observeEnvironment: vi.fn(async () => failed === 'observe' ? { status: 'unknown' } : oldEnvironment),
        capture: vi.fn(async () => ({ status: failed === 'capture' ? 'unknown' : 'ok', snapshot: live })),
      });
      await createCheckpointer(d).reconcile('timer');
      expect(d.store.writeLive).not.toHaveBeenCalled();
      expect(d.store.archiveEnvironment).not.toHaveBeenCalled();
    }
  });

  it('writes explicit empty only when a handmux deletion confirms tmux is empty', async () => {
    const emptyEnvironment = { id: 'env-empty', bootIdentity: oldEnvironment.bootIdentity, tmuxServerId: null };
    const empty = snapshot(emptyEnvironment, '2026-07-20T12:00:00.000Z', true);
    const d = deps({
      store: {
        readLive: vi.fn(async () => ({ status: 'ok', value: snapshot(oldEnvironment) })),
        writeLive: vi.fn(async () => {}),
        archiveEnvironment: vi.fn(),
      },
      observeEnvironment: vi.fn(async () => ({ ...emptyEnvironment, status: 'absent' })),
      capture: vi.fn(async () => ({ status: 'empty', snapshot: empty })),
    });

    await createCheckpointer(d).confirmEmpty();

    expect(d.store.archiveEnvironment).not.toHaveBeenCalled();
    expect(d.store.writeLive).toHaveBeenCalledWith(empty);
  });

  it('archives the old environment successfully before initializing the new live state', async () => {
    const d = deps({
      store: {
        readLive: vi.fn(async () => ({ status: 'ok', value: snapshot(oldEnvironment) })),
        archiveEnvironment: vi.fn(async () => ({ status: 'ok' })),
        writeLive: vi.fn(async () => {}),
      },
    });

    await createCheckpointer(d).reconcile('timer');

    expect(d.store.archiveEnvironment).toHaveBeenCalledWith({
      endedReason: 'boot-changed',
      detectedAt: '2026-07-20T12:00:00.000Z',
    });
    expect(d.store.archiveEnvironment.mock.invocationCallOrder[0]).toBeLessThan(d.store.writeLive.mock.invocationCallOrder[0]);
    expect(d.store.writeLive).toHaveBeenCalledWith(expect.objectContaining({ environment: newEnvironment }));
  });

  it('keeps old live untouched if archiving the replaced environment fails', async () => {
    const archiveError = new Error('disk full');
    const d = deps({
      store: {
        readLive: vi.fn(async () => ({ status: 'ok', value: snapshot(oldEnvironment) })),
        archiveEnvironment: vi.fn(async () => { throw archiveError; }),
        writeLive: vi.fn(),
      },
    });

    await expect(createCheckpointer(d).reconcile('timer')).rejects.toThrow('disk full');
    expect(d.store.writeLive).not.toHaveBeenCalled();
  });

  it('skips immediately when restore owns the writer lock', async () => {
    const d = deps({ lock: { tryAcquire: vi.fn(async () => null) } });

    await expect(createCheckpointer(d).reconcile('timer')).resolves.toEqual({ status: 'locked' });
    expect(d.observeEnvironment).not.toHaveBeenCalled();
    expect(d.capture).not.toHaveBeenCalled();
  });
});

describe('workspace graceful shutdown', () => {
  it('runs events, workspace and HTTP shutdown once and in order', async () => {
    const order = [];
    const shutdown = createGracefulShutdown({
      events: { stop: vi.fn(() => { order.push('events'); }) },
      workspace: { stop: vi.fn(async () => { order.push('workspace'); }) },
      server: { close: vi.fn(() => { order.push('server'); }) },
    });

    await Promise.all([shutdown(), shutdown()]);

    expect(order).toEqual(['events', 'workspace', 'server']);
  });
});

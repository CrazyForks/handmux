import { describe, expect, it, vi } from 'vitest';
import { createOperationManager, restoreRequestHash } from '../src/workspace/operations.js';
import { createWorkspaceRuntime } from '../src/workspace/runtime.js';

const UUIDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
];

const LOGICAL = {
  sessionOk: '20000000-0000-4000-8000-000000000001',
  sessionFail: '20000000-0000-4000-8000-000000000002',
  sessionAlready: '20000000-0000-4000-8000-000000000003',
  windowOk: '20000000-0000-4000-8000-000000000011',
  windowFail: '20000000-0000-4000-8000-000000000012',
  windowAlready: '20000000-0000-4000-8000-000000000013',
  paneOk: '20000000-0000-4000-8000-000000000021',
  paneFail: '20000000-0000-4000-8000-000000000022',
  paneAlready: '20000000-0000-4000-8000-000000000023',
};

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

function operationStore(seed = []) {
  const values = new Map(seed.map((value) => [value.id, structuredClone(value)]));
  const writes = [];
  return {
    values,
    writes,
    async writeOperation(value) { values.set(value.id, structuredClone(value)); writes.push(structuredClone(value)); return value; },
    async readOperation(id) { return values.has(id) ? { status: 'ok', value: structuredClone(values.get(id)) } : { status: 'missing' }; },
    async listOperations() { return [...values.values()].map((value) => ({ status: 'ok', id: value.id, value: structuredClone(value) })); },
  };
}

describe('workspace operation persistence', () => {
  it('persists pending, running and a successful terminal result while deduplicating the running request', async () => {
    const store = operationStore();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const manager = createOperationManager({ store, now: () => 1_000, randomUUID: () => UUIDS[0], pid: 77 });
    const runner = vi.fn(async ({ onProgress }) => {
      await onProgress({ completed: 1, total: 2, result: { logicalId: 's-a', status: 'restored' } });
      await gate;
      return { status: 'succeeded', results: [{ logicalId: 's-a', status: 'restored' }], mapping: { id: 'map-a' } };
    });

    const first = await manager.start({ checkpointId: 'cp-a', sessions: ['b', 'a', 'a'] }, runner);
    const duplicate = await manager.start({ sessions: ['a', 'b'], checkpointId: 'cp-a' }, runner);
    expect(duplicate).toMatchObject({ operationId: first.operationId, reused: true });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(store.writes.map((row) => row.status)).toEqual(expect.arrayContaining(['pending', 'running']));

    release();
    await flush();
    expect((await manager.get(first.operationId)).status).toBe('succeeded');
    expect(store.writes.at(-1)).toMatchObject({ status: 'succeeded', results: [{ logicalId: 's-a', status: 'restored' }], mapping: { id: 'map-a' } });
  });

  it.each([
    ['partial', { status: 'partial', results: [{ status: 'restored' }, { status: 'failed' }] }],
    ['failed', { status: 'failed', results: [{ status: 'failed' }] }],
  ])('persists %s terminal state', async (status, result) => {
    const store = operationStore();
    const manager = createOperationManager({ store, now: () => 2_000, randomUUID: () => UUIDS[1] });
    const started = await manager.start({ checkpointId: 'cp-a' }, async () => result);
    await flush();
    expect(await manager.get(started.operationId)).toMatchObject({ status, results: result.results });
  });

  it('marks orphaned pending/running operations interrupted and preserves completed results', async () => {
    const seed = [
      { id: UUIDS[0], status: 'running', requestHash: 'a', results: [{ logicalId: 's-ok', status: 'restored' }], updatedAt: 'old' },
      { id: UUIDS[1], status: 'succeeded', requestHash: 'b', results: [], updatedAt: 'old' },
    ];
    const store = operationStore(seed);
    const manager = createOperationManager({ store, now: () => 3_000 });

    expect(await manager.interruptOrphans()).toBe(1);
    expect(store.values.get(UUIDS[0])).toMatchObject({ status: 'interrupted', results: seed[0].results });
    expect(store.values.get(UUIDS[1]).status).toBe('succeeded');
  });

  it('keeps active operations owned by a live process and interrupts only dead or invalid owners', async () => {
    const request = { checkpointId: 'cp-a', sessions: [], historical: false };
    const seed = [
      { id: UUIDS[0], status: 'running', request, requestHash: restoreRequestHash(request), ownerPid: 101, results: [] },
      { id: UUIDS[1], status: 'pending', request, requestHash: 'hash-b', ownerPid: 202, results: [] },
      { id: UUIDS[2], status: 'running', request, requestHash: 'hash-c', ownerPid: 0, results: [] },
    ];
    const store = operationStore(seed);
    const isProcessAlive = vi.fn((ownerPid) => ownerPid === 101);
    const manager = createOperationManager({ store, now: () => 3_000, isProcessAlive });

    expect(await manager.interruptOrphans()).toBe(2);
    expect(store.values.get(UUIDS[0]).status).toBe('running');
    expect(store.values.get(UUIDS[1]).status).toBe('interrupted');
    expect(store.values.get(UUIDS[2]).status).toBe('interrupted');
    expect(isProcessAlive).toHaveBeenCalledTimes(2);
    expect(await manager.start(request, vi.fn())).toMatchObject({ operationId: UUIDS[0], reused: true, status: 'running' });
  });

  it('releases request deduplication when persisting running state fails', async () => {
    const store = operationStore();
    const write = store.writeOperation;
    let failRunning = true;
    store.writeOperation = async (operation) => {
      if (operation.status === 'running' && failRunning) {
        failRunning = false;
        throw new Error('disk full');
      }
      return write(operation);
    };
    const ids = [...UUIDS];
    const manager = createOperationManager({ store, randomUUID: () => ids.shift() });
    const runner = vi.fn(async () => ({ status: 'succeeded', results: [] }));

    const first = await manager.start({ checkpointId: 'cp-a' }, runner);
    await flush();
    expect((await manager.get(first.operationId)).status).toBe('failed');
    const retry = await manager.start({ checkpointId: 'cp-a' }, runner);
    await flush();
    expect(retry).toMatchObject({ reused: false });
    expect(retry.operationId).not.toBe(first.operationId);
    expect(runner).toHaveBeenCalledTimes(1);
    expect((await manager.get(retry.operationId)).status).toBe('succeeded');
  });
});

function workspaceFixture({ recoveryPending = [LOGICAL.sessionOk, LOGICAL.sessionFail, LOGICAL.sessionAlready] } = {}) {
  const checkpoint = {
    id: 'cp-a', capturedAt: '2026-07-20T01:00:00.000Z', archivedAt: '2026-07-20T01:01:00.000Z',
    environment: { endedReason: 'boot-changed' }, active: null,
    sessions: [
      { id: LOGICAL.sessionOk, runtimeId: '$1', name: 'api', windowLinks: [{ windowId: LOGICAL.windowOk, index: 0 }], activeWindowId: LOGICAL.windowOk },
      { id: LOGICAL.sessionFail, runtimeId: '$2', name: 'fail', windowLinks: [{ windowId: LOGICAL.windowFail, index: 0 }], activeWindowId: LOGICAL.windowFail },
      { id: LOGICAL.sessionAlready, runtimeId: '$3', name: 'docs', windowLinks: [{ windowId: LOGICAL.windowAlready, index: 0 }], activeWindowId: LOGICAL.windowAlready },
    ],
    windows: [
      { id: LOGICAL.windowOk, runtimeId: '@1', name: 'ok', index: 0, layout: 'x', activePaneId: LOGICAL.paneOk, panes: [{ id: LOGICAL.paneOk, runtimeId: '%1', index: 0, cwd: '/ok', agent: null }] },
      { id: LOGICAL.windowFail, runtimeId: '@2', name: 'fail', index: 0, layout: 'x', activePaneId: LOGICAL.paneFail, panes: [{ id: LOGICAL.paneFail, runtimeId: '%2', index: 0, cwd: '/fail', agent: null }] },
      { id: LOGICAL.windowAlready, runtimeId: '@3', name: 'docs', index: 0, layout: 'x', activePaneId: LOGICAL.paneAlready, panes: [{ id: LOGICAL.paneAlready, runtimeId: '%3', index: 0, cwd: '/docs', agent: null }] },
    ],
  };
  const recovery = {
    checkpointId: 'cp-a', detectedAt: '2026-07-20T02:00:00.000Z', expiresAt: '2026-07-20T03:00:00.000Z',
    initialSessionIds: checkpoint.sessions.map((session) => session.id), pendingSessionIds: recoveryPending,
    resolvedAt: recoveryPending.length ? null : '2026-07-20T02:30:00.000Z', mapping: null,
  };
  const operations = operationStore();
  const store = {
    ...operations,
    readLatestCheckpoint: vi.fn(async () => ({ status: 'ok', value: checkpoint })),
    readCheckpoint: vi.fn(async () => ({ status: 'ok', value: checkpoint })),
    readRecovery: vi.fn(async () => ({ status: 'ok', value: recovery })),
    listCheckpoints: vi.fn(async () => []),
    resolveSessions: vi.fn(async () => ({ status: 'ok', value: recovery })),
    mergeRecoveryMapping: vi.fn(async (_id, mapping) => ({ status: 'ok', value: { ...recovery, mapping } })),
    archiveEnvironment: vi.fn(),
  };
  return { checkpoint, recovery, store };
}

describe('workspace runtime orchestration', () => {
  it.each([
    ['ok', async () => ({ status: 'ok', value: { capturedAt: '2026-07-20T01:23:00.000Z' } }), { status: 'protected', lastSuccessfulCaptureAt: '2026-07-20T01:23:00.000Z', errorCode: null }],
    ['empty', async () => ({ status: 'empty' }), { status: 'unprotected', lastSuccessfulCaptureAt: null, errorCode: null }],
    ['corrupt', async () => ({ status: 'corrupt', errors: ['/Users/me/.handmux secret'] }), { status: 'degraded', lastSuccessfulCaptureAt: null, errorCode: 'live-corrupt' }],
    ['unavailable', async () => { throw new Error('/Users/me/.handmux secret-token EACCES'); }, { status: 'degraded', lastSuccessfulCaptureAt: null, errorCode: 'live-unavailable' }],
  ])('reports sanitized %s workspace protection status from live state', async (_label, readLive, expected) => {
    const runtime = createWorkspaceRuntime({
      store: { readLive },
      tmux: {}, lock: {}, checkpointer: {},
    });
    const result = await runtime.getProtectionStatus();
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toMatch(/Users|secret|EACCES/);
  });

  it('resolves latest to the actual checkpoint before operation persistence and deduplication', async () => {
    const operations = operationStore();
    let latestId = 'cp-a';
    const checkpoint = (id) => ({
      id, capturedAt: '2026-07-20T01:00:00.000Z', archivedAt: '2026-07-20T01:01:00.000Z',
      environment: { endedReason: 'boot-changed' }, active: null, sessions: [], windows: [],
    });
    const store = {
      ...operations,
      readLatestCheckpoint: vi.fn(async () => ({ status: 'ok', value: checkpoint(latestId) })),
      readCheckpoint: vi.fn(async (id) => ({ status: 'ok', value: checkpoint(id) })),
      readRecovery: vi.fn(async (id) => ({
        status: 'ok', value: { checkpointId: id, detectedAt: '2026-07-20T02:00:00.000Z', expiresAt: '2026-07-20T03:00:00.000Z', initialSessionIds: [], pendingSessionIds: [], resolvedAt: '2026-07-20T02:01:00.000Z', mapping: null },
      })),
    };
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const ids = [...UUIDS];
    const runtime = createWorkspaceRuntime({
      store,
      tmux: { captureTopology: async () => ({ status: 'ok', sessions: [], windows: [] }) },
      lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: { start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {}, reconcile: async () => ({ status: 'written' }) },
      executor: async () => { await gate; return { status: 'succeeded', results: [], mapping: null }; },
      randomUUID: () => ids.shift(),
    });

    const first = await runtime.startRestore({ checkpointId: 'latest' });
    await flush();
    const explicit = await runtime.startRestore({ checkpointId: 'cp-a' });
    expect(explicit).toMatchObject({ operationId: first.operationId, reused: true });
    expect(operations.values.get(first.operationId).request.checkpointId).toBe('cp-a');

    latestId = 'cp-b';
    const next = await runtime.startRestore({ checkpointId: 'latest' });
    expect(next).toMatchObject({ reused: false });
    expect(next.operationId).not.toBe(first.operationId);
    expect(operations.values.get(next.operationId).request.checkpointId).toBe('cp-b');
    release();
    await flush();
  });

  it('replans under the filesystem lock, resolves only successful/already sessions, persists mapping, and only reconciles live', async () => {
    const { store } = workspaceFixture();
    const captures = [
      { status: 'ok', sessions: [], windows: [] },
      { status: 'ok', sessions: [{ id: 'new', runtimeId: '$90', name: 'api' }, { id: LOGICAL.sessionAlready, runtimeId: '$91', name: 'docs' }], windows: [] },
    ];
    let lastCapture;
    const tmux = { captureTopology: vi.fn(async () => { if (captures.length) lastCapture = captures.shift(); return lastCapture; }) };
    const lock = { withLock: vi.fn(async (_owner, fn) => fn()) };
    const checkpointer = {
      start: vi.fn(async () => {}), stop: vi.fn(async () => {}), requestReconcile: vi.fn(), confirmEmpty: vi.fn(),
      reconcile: vi.fn(async () => ({ status: 'written' })),
    };
    const executor = vi.fn(async ({ plan }) => ({
      status: 'partial',
      results: plan.sessions.map((item) => item.logicalId === LOGICAL.sessionFail
        ? { logicalId: item.logicalId, status: 'failed' }
        : { logicalId: item.logicalId, sourceName: item.sourceName, targetName: item.targetName, status: item.action === 'already-present' ? 'already-present' : 'restored' }),
      mapping: { names: { api: 'api-restored' }, runtime: { sessions: { '$1': '$10' }, windows: {}, panes: {} }, logical: { sessions: { [LOGICAL.sessionOk]: '$10' }, windows: {}, panes: {} } },
    }));
    const runtime = createWorkspaceRuntime({ store, tmux, lock, checkpointer, executor, now: () => Date.parse('2026-07-20T02:10:00.000Z'), randomUUID: () => UUIDS[2] });

    const preview = await runtime.getRestorePlan({ checkpointId: 'latest' });
    expect(preview.sessions.find((item) => item.logicalId === LOGICAL.sessionOk).targetName).toBe('api');

    const { operationId } = await runtime.startRestore({ checkpointId: 'latest' });
    await flush();
    const operation = await runtime.getOperation(operationId);
    expect(operation.status).toBe('partial');
    expect(executor.mock.calls[0][0].plan.sessions.find((item) => item.logicalId === LOGICAL.sessionOk).targetName).toBe('api-restored');
    expect(store.resolveSessions).toHaveBeenCalledWith('cp-a', [LOGICAL.sessionOk, LOGICAL.sessionAlready]);
    expect(store.mergeRecoveryMapping).toHaveBeenCalledWith('cp-a', expect.objectContaining({ id: expect.any(String), checkpointId: 'cp-a' }));
    expect(checkpointer.reconcile).toHaveBeenCalledWith('restore-complete');
    expect(store.archiveEnvironment).not.toHaveBeenCalled();
  });

  it('keeps globally resolved default restores empty but historical restores may replan missing sessions', async () => {
    const { store } = workspaceFixture({ recoveryPending: [] });
    const tmux = { captureTopology: vi.fn(async () => ({ status: 'ok', sessions: [], windows: [] })) };
    const executor = vi.fn(async ({ plan }) => ({ status: 'succeeded', results: plan.sessions.map((item) => ({ logicalId: item.logicalId, status: 'restored' })), mapping: null }));
    const runtime = createWorkspaceRuntime({
      store, tmux, lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: { start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {}, reconcile: async () => ({}) },
      executor, randomUUID: (() => { const values = [...UUIDS]; return () => values.shift(); })(),
    });

    await runtime.restoreNow({ checkpointId: 'latest' });
    await runtime.restoreNow({ checkpointId: 'cp-a', historical: true });
    expect(executor.mock.calls[0][0].plan.sessions).toEqual([]);
    expect(executor.mock.calls[1][0].plan.sessions).toHaveLength(3);
  });

  it('rechecks the restore guard under lock and replans a racing tmux name change before mutation', async () => {
    const { store } = workspaceFixture();
    const empty = { status: 'ok', sessions: [], windows: [] };
    const occupied = { status: 'ok', sessions: [{ id: 'new', runtimeId: '$90', name: 'api' }], windows: [] };
    const captures = [empty, occupied, occupied];
    const executor = vi.fn(async ({ plan }) => ({ status: 'succeeded', results: [], mapping: null, target: plan.sessions[0].targetName }));
    const runtime = createWorkspaceRuntime({
      store,
      tmux: { captureTopology: vi.fn(async () => captures.shift()) },
      lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: { start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {}, reconcile: async () => ({ status: 'written' }) },
      executor,
      randomUUID: () => UUIDS[0],
    });

    const operation = await runtime.restoreNow({ checkpointId: 'cp-a', historical: true, sessions: ['api'] });
    expect(operation).toMatchObject({ status: 'succeeded', target: 'api-restored' });
    expect(executor).toHaveBeenCalledOnce();
  });

  it('fails closed without executing when the restore guard keeps changing', async () => {
    const { store } = workspaceFixture();
    let version = 0;
    const executor = vi.fn(async () => ({ status: 'succeeded', results: [], mapping: null }));
    const runtime = createWorkspaceRuntime({
      store,
      tmux: { captureTopology: vi.fn(async () => ({
        status: 'ok', sessions: [{ id: `live-${version}`, runtimeId: `$${90 + version}`, name: `race-${version++}` }], windows: [],
      })) },
      lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: { start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {}, reconcile: async () => ({ status: 'written' }) },
      executor,
      restoreGuardAttempts: 2,
      randomUUID: () => UUIDS[0],
    });

    expect(await runtime.restoreNow({ checkpointId: 'cp-a', historical: true })).toMatchObject({
      status: 'failed', error: expect.stringMatching(/topology.*changed/i),
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(['locked', 'unknown', 'corrupt', 'stopped', 'changed-during-capture'])('keeps restore successful but warns when reconcile returns %s', async (reconcileStatus) => {
    const { store } = workspaceFixture({ recoveryPending: [] });
    const runtime = createWorkspaceRuntime({
      store,
      tmux: { captureTopology: async () => ({ status: 'ok', sessions: [], windows: [] }) },
      lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: {
        start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {},
        reconcile: async () => ({ status: reconcileStatus }),
      },
      executor: async () => ({ status: 'succeeded', results: [], mapping: null }),
      randomUUID: () => UUIDS[0],
    });

    expect(await runtime.restoreNow({ checkpointId: 'latest' })).toMatchObject({
      status: 'succeeded', warnings: [expect.stringMatching(new RegExp(`reconcile.*${reconcileStatus}`, 'i'))],
    });
  });

  it.each(['written', 'unchanged'])('accepts reconcile status %s without a warning', async (reconcileStatus) => {
    const { store } = workspaceFixture({ recoveryPending: [] });
    const runtime = createWorkspaceRuntime({
      store,
      tmux: { captureTopology: async () => ({ status: 'ok', sessions: [], windows: [] }) },
      lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: {
        start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {},
        reconcile: async () => ({ status: reconcileStatus }),
      },
      executor: async () => ({ status: 'succeeded', results: [], mapping: null }),
      randomUUID: () => UUIDS[0],
    });

    expect(await runtime.restoreNow({ checkpointId: 'latest' })).toMatchObject({ status: 'succeeded' });
    expect((await runtime.getOperation(UUIDS[0])).warnings || []).toEqual([]);
  });

  it('keeps a successful restore terminal when the follow-up live reconcile fails', async () => {
    const { store } = workspaceFixture({ recoveryPending: [] });
    const runtime = createWorkspaceRuntime({
      store,
      tmux: { captureTopology: async () => ({ status: 'ok', sessions: [], windows: [] }) },
      lock: { withLock: async (_owner, fn) => fn() },
      checkpointer: {
        start: async () => {}, stop: async () => {}, requestReconcile() {}, confirmEmpty() {},
        reconcile: async () => { throw new Error('live write failed'); },
      },
      executor: async () => ({ status: 'succeeded', results: [], mapping: null }),
      randomUUID: () => UUIDS[0],
    });

    expect(await runtime.restoreNow({ checkpointId: 'latest' })).toMatchObject({
      status: 'succeeded', warnings: [expect.stringMatching(/reconcile.*live write failed/i)],
    });
  });
});

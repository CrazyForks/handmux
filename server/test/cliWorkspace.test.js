import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/cli/i18n/index.js';
import { createStandaloneWorkspaceRuntime, runWorkspaceCommand } from '../src/cli/workspaceCmd.js';

const checkpoint = (id, archivedAt = '2026-07-20T02:00:00.000Z') => ({
  status: 'ok',
  id,
  value: {
    id,
    capturedAt: archivedAt,
    archivedAt,
    sessions: [{ id: `s-${id}`, name: id }],
    windows: [{ id: `w-${id}`, panes: [{ id: `p-${id}`, agent: { id: 'claude' } }] }],
  },
});

const plan = (checkpointId = 'newest') => ({
  checkpointId,
  capturedAt: '2026-07-20T02:00:00.000Z',
  summary: { sessions: 2, windows: 2, panes: 2, agents: 1 },
  planSummary: { create: 1, renamed: 0, alreadyPresent: 1, unsupported: 0, windows: 1, panes: 1, agents: 1 },
  preExistingRuntimeIds: { sessions: ['$9'], windows: ['@9'], panes: ['%9'] },
  sessions: [
    { logicalId: 's-api', sourceName: 'api', targetName: 'api', action: 'create' },
    { logicalId: 's-docs', sourceName: 'docs', action: 'already-present' },
  ],
  warnings: [],
});

function output() {
  return {
    value: '',
    write(chunk) { this.value += String(chunk); },
  };
}

function fakeRuntime({ rows = [checkpoint('newest')], restore, restorePlan } = {}) {
  return {
    listCheckpoints: vi.fn(async () => rows),
    getRestorePlan: vi.fn(async ({ checkpointId }) => restorePlan || plan(checkpointId)),
    restoreNow: vi.fn(async () => restore || {
      status: 'succeeded', restored: 1, alreadyPresent: 1, failed: 0,
      results: [
        { logicalId: 's-api', sourceName: 'api', targetName: 'api', status: 'restored', warnings: [] },
        { logicalId: 's-docs', sourceName: 'docs', status: 'already-present' },
      ],
      warnings: [],
    }),
  };
}

async function run({ flags = {}, runtime = fakeRuntime(), inputIsTTY = false, outputIsTTY = false, selectCheckpoint = vi.fn(), } = {}) {
  const stdout = output();
  const stderr = output();
  const code = await runWorkspaceCommand({
    flags, runtime, inputIsTTY, outputIsTTY, selectCheckpoint, stdout, stderr,
  });
  return { code, runtime, selectCheckpoint, stdout: stdout.value, stderr: stderr.value };
}

beforeEach(() => setLocale('en'));

describe('workspace restore CLI selection', () => {
  it('restores the only available checkpoint directly', async () => {
    const result = await run();

    expect(result.code).toBe(0);
    expect(result.selectCheckpoint).not.toHaveBeenCalled();
    expect(result.runtime.restoreNow).toHaveBeenCalledWith(expect.objectContaining({ checkpointId: 'newest' }));
  });

  it('asks on a TTY when multiple checkpoints exist', async () => {
    const rows = [checkpoint('newest'), checkpoint('older', '2026-07-19T02:00:00.000Z')];
    const selectCheckpoint = vi.fn(async () => 'older');
    const result = await run({ runtime: fakeRuntime({ rows }), inputIsTTY: true, outputIsTTY: true, selectCheckpoint });

    expect(result.code).toBe(0);
    expect(selectCheckpoint).toHaveBeenCalledWith(rows);
    expect(result.runtime.restoreNow).toHaveBeenCalledWith(expect.objectContaining({ checkpointId: 'older', historical: true }));
  });

  it('chooses the newest checkpoint without prompting when either stream is not a TTY', async () => {
    const rows = [checkpoint('newest'), checkpoint('older', '2026-07-19T02:00:00.000Z')];
    const result = await run({ runtime: fakeRuntime({ rows }), inputIsTTY: true, outputIsTTY: false });

    expect(result.code).toBe(0);
    expect(result.selectCheckpoint).not.toHaveBeenCalled();
    expect(result.runtime.restoreNow).toHaveBeenCalledWith(expect.objectContaining({ checkpointId: 'newest' }));
  });

  it('skips selection for an explicit checkpoint and resolves the explicit latest alias', async () => {
    const direct = await run({ flags: { checkpoint: 'older' } });
    expect(direct.runtime.listCheckpoints).not.toHaveBeenCalled();
    expect(direct.selectCheckpoint).not.toHaveBeenCalled();
    expect(direct.runtime.restoreNow).toHaveBeenCalledWith({ checkpointId: 'older', sessions: [], historical: true });

    const latest = await run({ flags: { checkpoint: 'latest' } });
    expect(latest.runtime.restoreNow).toHaveBeenCalledWith({ checkpointId: 'newest', sessions: [], historical: true });
  });
});

describe('workspace restore CLI modes and exit codes', () => {
  it('lists valid and corrupt checkpoints without trying to restore', async () => {
    const runtime = fakeRuntime({ rows: [checkpoint('newest'), { status: 'corrupt', id: 'broken', error: 'hash mismatch' }] });
    const result = await run({ flags: { list: true }, runtime });

    expect(result.code).toBe(0);
    expect(runtime.getRestorePlan).not.toHaveBeenCalled();
    expect(runtime.restoreNow).not.toHaveBeenCalled();
    expect(result.stdout).toMatch(/newest.*1 session.*1 window.*1 pane.*1 agent/i);
    expect(result.stdout).toMatch(/broken.*unavailable.*hash mismatch/i);
  });

  it('rejects --list combinations and malformed values with usage exit code 2', async () => {
    const combined = await run({ flags: { list: true, dryRun: true } });
    expect(combined.code).toBe(2);
    expect(combined.stderr).toMatch(/--list.*alone|cannot.*--dry-run/i);

    const missing = await run({ flags: { checkpoint: true } });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/--checkpoint.*value/i);

    const unsafe = await run({ flags: { checkpoint: '../outside' } });
    expect(unsafe.code).toBe(2);
    expect(unsafe.stderr).toMatch(/--checkpoint.*valid id/i);
  });

  it('passes every repeated --session selection to the runtime', async () => {
    const result = await run({ flags: { session: ['api', 'web'] } });

    expect(result.code).toBe(0);
    expect(result.runtime.restoreNow).toHaveBeenCalledWith(expect.objectContaining({ sessions: ['api', 'web'] }));
  });

  it('dry-run prints the immutable plan and performs zero restore mutation', async () => {
    const result = await run({ flags: { dryRun: true } });

    expect(result.code).toBe(0);
    expect(result.runtime.getRestorePlan).toHaveBeenCalledTimes(1);
    expect(result.runtime.restoreNow).not.toHaveBeenCalled();
    expect(result.stdout).toMatch(/\+ api/);
    expect(result.stdout).toMatch(/= docs.*already restored/i);
    expect(result.stdout).toMatch(/No existing session or process will be stopped or modified/i);
    expect(result.stdout).toMatch(/Run `handmux restore` to continue/i);
  });

  it('returns 1 when there is no usable checkpoint', async () => {
    const result = await run({ runtime: fakeRuntime({ rows: [{ status: 'corrupt', id: 'broken', error: 'bad hash' }] }) });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/no usable checkpoint/i);
    expect(result.stderr).toMatch(/handmux.*protect|next.*restart/i);
  });

  it('returns 1 for a partial restore and names checkpoint, session, stage, and next action', async () => {
    const runtime = fakeRuntime({ restore: {
      status: 'partial', restored: 1, alreadyPresent: 0, failed: 1,
      results: [
        { logicalId: 's-api', sourceName: 'api', targetName: 'api', status: 'restored', warnings: [] },
        { logicalId: 's-web', sourceName: 'web', status: 'failed', stage: 'topology', error: 'tmux disappeared' },
      ],
      warnings: [],
    } });
    const result = await run({ runtime });

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/✓ api/);
    expect(result.stderr).toMatch(/checkpoint newest.*session web.*stage topology/i);
    expect(result.stderr).toMatch(/retry.*--checkpoint newest.*--session web/i);
  });

  it('returns 0 when every selected session is already present', async () => {
    const runtime = fakeRuntime({ restore: {
      status: 'succeeded', restored: 0, alreadyPresent: 1, failed: 0,
      results: [{ logicalId: 's-docs', sourceName: 'docs', status: 'already-present' }], warnings: [],
    } });
    const result = await run({ runtime });

    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/= docs.*already restored/i);
  });

  it('turns runtime exceptions into actionable exit code 1 errors', async () => {
    const runtime = fakeRuntime();
    runtime.restoreNow.mockRejectedValue(new Error('writer lock timed out; held by restore-7 (pid 42)'));
    const result = await run({ runtime });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/checkpoint newest/i);
    expect(result.stderr).toMatch(/writer lock timed out.*pid 42/i);
    expect(result.stderr).toMatch(/retry/i);
  });

  it('prints the persisted operation error when restoreNow returns a failed operation without rows', async () => {
    const runtime = fakeRuntime({ restore: {
      status: 'failed', restored: 0, alreadyPresent: 0, failed: 0, results: [],
      error: 'checkpoint payload hash mismatch', warnings: [],
    } });
    const result = await run({ runtime });

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/checkpoint newest.*stage restore/i);
    expect(result.stderr).toMatch(/payload hash mismatch/i);
    expect(result.stderr).toMatch(/retry.*--checkpoint newest/i);
  });
});

describe('standalone runtime composition', () => {
  it('uses the supplied workspace dependencies and does not read daemon state or real home', () => {
    const store = { paths: { lockDir: '/fake/workspaces/restore.lock' } };
    const tmux = { captureTopology: vi.fn() };
    const lock = { withLock: vi.fn() };
    const checkpointer = { reconcile: vi.fn() };
    const createStore = vi.fn(() => store);
    const createTmux = vi.fn(() => tmux);
    const createLock = vi.fn(() => lock);
    const createCheckpointer = vi.fn(() => checkpointer);
    const createRuntime = vi.fn(() => ({ listCheckpoints: vi.fn(), getRestorePlan: vi.fn(), restoreNow: vi.fn() }));

    const runtime = createStandaloneWorkspaceRuntime({
      home: '/fake/home', createStore, createTmux, createLock, createCheckpointer, createRuntime,
      runTmux: vi.fn(), observeEnvironment: vi.fn(), stateFile: '/fake/agents.json',
    });

    expect(runtime).toBe(createRuntime.mock.results[0].value);
    expect(createStore).toHaveBeenCalledWith({ home: '/fake/home' });
    expect(createLock).toHaveBeenCalledWith({ dir: '/fake/workspaces/restore.lock' });
    expect(createRuntime).toHaveBeenCalledWith(expect.objectContaining({ store, tmux, lock, checkpointer, home: '/fake/home' }));
  });
});

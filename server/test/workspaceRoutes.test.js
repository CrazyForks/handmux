import fs from 'node:fs';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApiRouter } from '../src/httpApi.js';

const auth = (call) => call.set('Authorization', 'Bearer good');

function fakeWorkspace(overrides = {}) {
  return {
    getProtectionStatus: vi.fn(async () => ({
      status: 'degraded',
      lastSuccessfulCaptureAt: '2026-07-20T01:00:00.000Z',
      errorCode: 'permission-denied',
    })),
    listCheckpoints: vi.fn(async () => [{ status: 'ok', id: 'checkpoint-a' }]),
    getRestorePlan: vi.fn(async () => ({
      checkpointId: 'checkpoint-a',
      serverNow: '2026-07-20T02:00:00.000Z',
      expiresAt: '2026-07-20T01:59:59.000Z',
      promptEligible: false,
      pendingCount: 1,
      mapping: { id: 'mapping-a' },
    })),
    startRestore: vi.fn(async () => ({ operationId: 'operation-a', status: 'pending', reused: false })),
    getOperation: vi.fn(async () => null),
    ...overrides,
  };
}

function makeApp(workspace) {
  const app = express();
  app.use('/api', createApiRouter({
    token: 'good',
    commands: {},
    events: { getStates: vi.fn(async () => []) },
    workspace,
  }));
  return app;
}

describe('workspace API routes', () => {
  let workspace;
  let app;

  beforeEach(() => {
    workspace = fakeWorkspace();
    app = makeApp(workspace);
  });

  it('protects every workspace endpoint with bearer authentication', async () => {
    await request(app).get('/api/workspace/status').expect(401, { error: 'unauthorized' });
    await request(app).get('/api/workspace/checkpoints').expect(401, { error: 'unauthorized' });
    await request(app).get('/api/workspace/restore-plan').expect(401, { error: 'unauthorized' });
    await request(app).post('/api/workspace/restore').send({ checkpointId: 'latest' }).expect(401, { error: 'unauthorized' });
    await request(app).get('/api/workspace/restore/operation-a').expect(401, { error: 'unauthorized' });
    expect(workspace.getProtectionStatus).not.toHaveBeenCalled();
    expect(workspace.listCheckpoints).not.toHaveBeenCalled();
    expect(workspace.getRestorePlan).not.toHaveBeenCalled();
    expect(workspace.startRestore).not.toHaveBeenCalled();
    expect(workspace.getOperation).not.toHaveBeenCalled();
  });

  it('returns the server-authored protection status and checkpoint list', async () => {
    const status = await auth(request(app).get('/api/workspace/status')).expect(200);
    const checkpoints = await auth(request(app).get('/api/workspace/checkpoints')).expect(200);
    expect(status.body).toEqual({
      status: 'degraded',
      lastSuccessfulCaptureAt: '2026-07-20T01:00:00.000Z',
      errorCode: 'permission-denied',
    });
    expect(checkpoints.body).toEqual([{ status: 'ok', id: 'checkpoint-a' }]);
  });

  it('requests latest by default and preserves the runtime-authored clock, eligibility, and mapping', async () => {
    const response = await auth(request(app).get('/api/workspace/restore-plan')).expect(200);
    expect(workspace.getRestorePlan).toHaveBeenCalledWith({ checkpointId: 'latest' });
    expect(response.body).toMatchObject({
      serverNow: '2026-07-20T02:00:00.000Z',
      expiresAt: '2026-07-20T01:59:59.000Z',
      promptEligible: false,
      pendingCount: 1,
      mapping: { id: 'mapping-a' },
    });
  });

  it('accepts an explicit safe checkpoint id', async () => {
    await auth(request(app).get('/api/workspace/restore-plan?checkpoint=checkpoint-2')).expect(200);
    expect(workspace.getRestorePlan).toHaveBeenCalledWith({ checkpointId: 'checkpoint-2' });
  });

  it('rejects malformed checkpoint ids before calling the runtime', async () => {
    await auth(request(app).get('/api/workspace/restore-plan?checkpoint=../../secret'))
      .expect(400, { error: 'bad checkpoint id' });
    expect(workspace.getRestorePlan).not.toHaveBeenCalled();
  });

  it('returns 404 for a checkpoint the runtime cannot find', async () => {
    const error = Object.assign(new Error('/private/home/.handmux/checkpoints/missing.json'), {
      code: 'WORKSPACE_CHECKPOINT_NOT_FOUND',
    });
    workspace.getRestorePlan.mockRejectedValueOnce(error);
    await auth(request(app).get('/api/workspace/restore-plan?checkpoint=missing'))
      .expect(404, { error: 'checkpoint not found' });
  });

  it('starts a validated restore asynchronously with HTTP 202', async () => {
    const response = await auth(request(app).post('/api/workspace/restore'))
      .send({ checkpointId: 'latest', sessions: ['api', 'web'] })
      .expect(202);
    expect(response.body).toEqual({ operationId: 'operation-a', status: 'pending', reused: false });
    expect(workspace.startRestore).toHaveBeenCalledTimes(1);
    expect(workspace.startRestore).toHaveBeenCalledWith({ checkpointId: 'latest', sessions: ['api', 'web'] });
  });

  it('rejects invalid restore bodies without starting an operation', async () => {
    for (const body of [
      { checkpointId: '../../secret' },
      { checkpointId: 'latest', sessions: 'api' },
      { checkpointId: 'latest', sessions: [''] },
      { checkpointId: 'latest', historical: true },
    ]) {
      await auth(request(app).post('/api/workspace/restore')).send(body).expect(400, { error: 'bad request' });
    }
    expect(workspace.startRestore).not.toHaveBeenCalled();
  });

  it('returns the same runtime operation for a repeated double tap', async () => {
    workspace.startRestore
      .mockResolvedValueOnce({ operationId: 'operation-a', status: 'pending', reused: false })
      .mockResolvedValueOnce({ operationId: 'operation-a', status: 'running', reused: true });
    const first = await auth(request(app).post('/api/workspace/restore')).send({ checkpointId: 'latest' }).expect(202);
    const second = await auth(request(app).post('/api/workspace/restore')).send({ checkpointId: 'latest' }).expect(202);
    expect(first.body.operationId).toBe('operation-a');
    expect(second.body).toMatchObject({ operationId: 'operation-a', reused: true });
  });

  it('returns persisted terminal operation state and 404 for an unknown operation', async () => {
    workspace.getOperation
      .mockResolvedValueOnce({
        id: 'operation-a',
        status: 'partial',
        progress: { completed: 2, total: 2 },
        results: [
          { logicalId: 's-api', status: 'restored' },
          { logicalId: 's-web', status: 'failed', stage: 'topology', error: 'tmux disappeared' },
        ],
        mapping: { id: 'mapping-a' },
      })
      .mockResolvedValueOnce(null);
    const terminal = await auth(request(app).get('/api/workspace/restore/operation-a')).expect(200);
    expect(terminal.body).toMatchObject({
      id: 'operation-a',
      status: 'partial',
      progress: { completed: 2, total: 2 },
      mapping: { id: 'mapping-a' },
    });
    await auth(request(app).get('/api/workspace/restore/operation-missing'))
      .expect(404, { error: 'operation not found' });
  });

  it('rejects malformed operation ids before touching persisted storage', async () => {
    await auth(request(app).get('/api/workspace/restore/bad%20operation'))
      .expect(400, { error: 'bad operation id' });
    expect(workspace.getOperation).not.toHaveBeenCalled();
  });

  it('redacts unexpected workspace errors instead of exposing paths or stack details', async () => {
    workspace.getProtectionStatus.mockRejectedValueOnce(new Error('/Users/me/.handmux secret-token EACCES'));
    const response = await auth(request(app).get('/api/workspace/status')).expect(500);
    expect(response.body).toEqual({ error: 'workspace unavailable' });
    expect(response.text).not.toContain('/Users/me');
    expect(response.text).not.toContain('secret-token');
  });

  it('does not mount workspace routes when no runtime was injected', async () => {
    await auth(request(makeApp(undefined)).get('/api/workspace/status')).expect(404);
  });
});

describe('workspace production composition', () => {
  it('wraps the background checkpointer in the unified runtime used by events and API', () => {
    const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
    expect(source).toContain("import { createWorkspaceRuntime } from './workspace/runtime.js';");
    expect(source).toMatch(/const workspaceBackground = createWorkspaceBackground\(/);
    expect(source).toMatch(/const workspace = createWorkspaceRuntime\(\{[\s\S]*checkpointer: workspaceBackground/);
    expect(source).toContain('onStateChange: workspace.requestReconcile');
    expect(source).toContain('createApiRouter({ token, events, uploadExts, previews, previewDomain, workspace })');
  });
});

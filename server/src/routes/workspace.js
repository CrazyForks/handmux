import express from 'express';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESTORE_FIELDS = new Set(['checkpointId', 'sessions']);

function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) && value !== '.' && value !== '..';
}

function isCheckpointMissing(error) {
  if (error?.code === 'WORKSPACE_CHECKPOINT_NOT_FOUND' || error?.status === 404) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:checkpoint.*(?:missing|not found)|no valid checkpoint)/i.test(message);
}

function sendFailure(res, error, { checkpoint = false } = {}) {
  if (checkpoint && isCheckpointMissing(error)) {
    return res.status(404).json({ error: 'checkpoint not found' });
  }
  return res.status(500).json({ error: 'workspace unavailable' });
}

function asyncHandler(handler, options) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      sendFailure(res, error, options);
    }
  };
}

function checkpointId(value, fallback) {
  const id = value === undefined ? fallback : value;
  return isSafeId(id) ? id : null;
}

function parseRestoreRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some((key) => !RESTORE_FIELDS.has(key))) return null;
  const id = checkpointId(body.checkpointId, 'latest');
  if (!id) return null;
  const request = { checkpointId: id };
  if (body.sessions !== undefined) {
    if (!Array.isArray(body.sessions)
      || body.sessions.some((name) => typeof name !== 'string' || !name || name.length > 256 || /[\x00-\x1f\x7f]/.test(name))) {
      return null;
    }
    request.sessions = body.sessions;
  }
  return request;
}

export function workspaceRoutes({ workspace }) {
  const r = express.Router();

  r.get('/workspace/status', asyncHandler(async (_req, res) => {
    res.json(await workspace.getProtectionStatus());
  }));

  r.get('/workspace/checkpoints', asyncHandler(async (_req, res) => {
    res.json(await workspace.listCheckpoints());
  }));

  r.get('/workspace/restore-plan', asyncHandler(async (req, res) => {
    const id = checkpointId(req.query.checkpoint, 'latest');
    if (!id) return res.status(400).json({ error: 'bad checkpoint id' });
    // serverNow, promptEligible, pending recovery state, and mapping are runtime-authored. The route
    // deliberately passes them through without interpreting expiresAt using a client-supplied clock.
    res.json(await workspace.getRestorePlan({ checkpointId: id }));
  }, { checkpoint: true }));

  r.post('/workspace/restore', asyncHandler(async (req, res) => {
    const restoreRequest = parseRestoreRequest(req.body);
    if (!restoreRequest) return res.status(400).json({ error: 'bad request' });
    res.status(202).json(await workspace.startRestore(restoreRequest));
  }, { checkpoint: true }));

  r.get('/workspace/restore/:operationId', asyncHandler(async (req, res) => {
    if (!isSafeId(req.params.operationId)) return res.status(400).json({ error: 'bad operation id' });
    const operation = await workspace.getOperation(req.params.operationId);
    if (!operation) return res.status(404).json({ error: 'operation not found' });
    res.json(operation);
  }));

  return r;
}

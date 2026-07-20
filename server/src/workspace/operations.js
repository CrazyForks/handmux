import crypto from 'node:crypto';

const ACTIVE = new Set(['pending', 'running']);
const TERMINAL = new Set(['succeeded', 'partial', 'failed']);

function iso(now) {
  return new Date(typeof now === 'function' ? now() : now).toISOString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const unavailableLock = async () => { throw new Error('workspace operation lock is unavailable'); };
const INACTIVE_OPERATION = 'WORKSPACE_OPERATION_INACTIVE';

export function normalizeRestoreRequest(request = {}) {
  const checkpointId = typeof request.checkpointId === 'string' && request.checkpointId ? request.checkpointId : 'latest';
  const rawSessions = Array.isArray(request.sessions) ? request.sessions : request.sessions ? [request.sessions] : [];
  const sessions = [...new Set(rawSessions.filter((name) => typeof name === 'string' && name))].sort();
  return { checkpointId, sessions, historical: request.historical === true };
}

export function restoreRequestHash(request) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizeRestoreRequest(request))).digest('hex');
}

export function createOperationManager({
  store,
  now = Date.now,
  randomUUID = crypto.randomUUID,
  pid = process.pid,
  tryAcquireOperationLock = unavailableLock,
  pendingGraceMs = 250,
  wait = delay,
} = {}) {
  const values = new Map();
  const activeByHash = new Map();
  const localIds = new Set();

  async function persist(operation) {
    if (localIds.has(operation.id)) values.set(operation.id, operation);
    await store.writeOperation(operation);
    return operation;
  }

  async function readFresh(id) {
    const result = await store.readOperation(id);
    return result.status === 'ok' ? result.value : null;
  }

  async function assessExternal(operation, { allowPendingGrace = true } = {}) {
    let current = await readFresh(operation.id);
    if (!current) return { active: false, operation: null };
    if (!ACTIVE.has(current?.status)) return { active: false, operation: current };
    if (current.status === 'pending' && allowPendingGrace) {
      const createdAt = Date.parse(current.createdAt);
      const age = Number.isFinite(createdAt) ? Math.max(0, now() - createdAt) : Number.POSITIVE_INFINITY;
      const remaining = pendingGraceMs - age;
      if (remaining > 0) {
        await wait(remaining);
        current = await readFresh(current.id);
        if (!current || !ACTIVE.has(current.status)) return { active: false, operation: current };
      }
    }
    let handle;
    try {
      handle = await tryAcquireOperationLock({ operationId: `assess-${current.id}` });
    } catch {
      return { active: true, operation: current };
    }
    if (!handle) return { active: true, operation: current };
    try {
      current = await readFresh(current.id);
      if (!current || !ACTIVE.has(current.status)) return { active: false, operation: current };
      const interrupted = {
        ...current,
        status: 'interrupted',
        error: 'restore interrupted by process restart; retry the restore',
        completedAt: iso(now),
        updatedAt: iso(now),
      };
      await store.writeOperation(interrupted);
      return { active: false, operation: interrupted, interrupted: true };
    } finally {
      await handle.release();
    }
  }

  async function findExternalActive(requestHash) {
    const rows = typeof store.listOperations === 'function' ? await store.listOperations() : [];
    for (const row of rows) {
      if (row.status !== 'ok' || localIds.has(row.value?.id) || !ACTIVE.has(row.value?.status)) continue;
      if (row.value.requestHash !== requestHash || row.value.requestHash !== restoreRequestHash(row.value.request)) continue;
      const assessed = await assessExternal(row.value);
      if (assessed.active) return assessed.operation;
    }
    return null;
  }

  async function execute(operation, runner, { deferRunning = false } = {}) {
    let current = operation;
    let running = false;
    let terminalStatus = null;
    const onRunning = async () => {
      if (running) return current;
      const persisted = await readFresh(current.id);
      if (!persisted || !ACTIVE.has(persisted.status)) {
        if (persisted) {
          current = persisted;
          if (localIds.has(current.id)) values.set(current.id, current);
        } else {
          localIds.delete(current.id);
          values.delete(current.id);
        }
        const error = new Error(`restore operation ${current.id} is no longer active`);
        error.code = INACTIVE_OPERATION;
        error.operation = persisted;
        throw error;
      }
      current = persisted;
      current = await persist({
        ...current,
        status: 'running',
        startedAt: iso(now),
        updatedAt: iso(now),
      });
      running = true;
      return current;
    };
    const onTerminal = async (value) => {
      await onRunning();
      const result = value instanceof Error
        ? { status: 'failed', error: errorMessage(value) }
        : value;
      const requestedStatus = TERMINAL.has(result?.status) ? result.status : 'failed';
      if (terminalStatus && requestedStatus !== terminalStatus) return current;
      const status = terminalStatus || requestedStatus;
      const candidate = {
        ...current,
        ...result,
        status,
        progress: { completed: result?.results?.length ?? current.progress.completed, total: current.progress.total },
        completedAt: current.completedAt || iso(now),
      };
      if (terminalStatus && JSON.stringify(candidate) === JSON.stringify(current)) return current;
      current = await persist({ ...candidate, updatedAt: iso(now) });
      terminalStatus = status;
      return current;
    };
    try {
      if (!deferRunning) await onRunning();
      const result = await runner({
        operationId: current.id,
        request: current.request,
        onRunning,
        onTerminal,
        onProgress: async ({ completed, total, result: row }) => {
          await onRunning();
          const results = row ? [...(current.results || []), row] : (current.results || []);
          current = await persist({
            ...current,
            progress: { completed, total },
            results,
            updatedAt: iso(now),
          });
        },
      });
      await onTerminal(result);
    } catch (error) {
      if (error?.code === INACTIVE_OPERATION) {
        if (error.operation) current = error.operation;
      } else {
        try { await onTerminal(error); } catch { /* pending/running file is interrupted on restart */ }
      }
    } finally {
      if (activeByHash.get(operation.requestHash) === operation.id) activeByHash.delete(operation.requestHash);
    }
    return current;
  }

  async function createPending(request) {
    const normalized = normalizeRestoreRequest(request);
    const requestHash = restoreRequestHash(normalized);
    const existingId = activeByHash.get(requestHash);
    if (existingId) return { reused: true, operation: values.get(existingId) };
    const external = await findExternalActive(requestHash);
    if (external) return { reused: true, operation: external };
    const id = randomUUID();
    const operation = {
      id,
      kind: 'workspace-restore',
      status: 'pending',
      request: normalized,
      requestHash,
      ownerPid: pid,
      createdAt: iso(now),
      updatedAt: iso(now),
      startedAt: null,
      completedAt: null,
      progress: { completed: 0, total: 0 },
      results: [],
      mapping: null,
      error: null,
    };
    localIds.add(id);
    activeByHash.set(requestHash, id);
    try {
      await persist(operation);
    } catch (error) {
      activeByHash.delete(requestHash);
      localIds.delete(id);
      values.delete(id);
      throw error;
    }
    return { reused: false, operation };
  }

  async function start(request, runner, options) {
    const pending = await createPending(request);
    if (pending.reused) {
      return { operationId: pending.operation.id, status: pending.operation.status, reused: true };
    }
    Promise.resolve().then(() => execute(pending.operation, runner, options)).catch(() => {});
    return { operationId: pending.operation.id, status: 'pending', reused: false };
  }

  async function run(request, runner, options) {
    const pending = await createPending(request);
    if (pending.reused) return pending.operation;
    return execute(pending.operation, runner, options);
  }

  async function get(id) {
    if (localIds.has(id) && values.has(id)) return values.get(id);
    return readFresh(id);
  }

  async function interruptOrphans() {
    const rows = typeof store.listOperations === 'function' ? await store.listOperations() : [];
    let interrupted = 0;
    for (const row of rows) {
      if (row.status !== 'ok' || localIds.has(row.value?.id) || !ACTIVE.has(row.value?.status)) continue;
      const assessed = await assessExternal(row.value);
      if (assessed.interrupted) interrupted += 1;
    }
    return interrupted;
  }

  return { start, run, get, interruptOrphans };
}

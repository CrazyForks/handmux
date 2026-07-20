import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const OWNER_FILE = 'owner.json';
const SAFE_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ownerLabel(owner) {
  if (!owner) return 'unknown owner';
  const operation = typeof owner.operationId === 'string' && owner.operationId ? owner.operationId : 'unknown operation';
  const pid = Number.isInteger(owner.pid) ? owner.pid : 'unknown';
  return `${operation} (pid ${pid})`;
}

export function createWorkspaceLock({
  dir,
  fs = fsp,
  pid = process.pid,
  now = Date.now,
  isProcessAlive = defaultProcessAlive,
  wait = delay,
  timeoutMs = 5_000,
  retryMs = 50,
  staleGraceMs = 5_000,
  randomUUID = crypto.randomUUID,
} = {}) {
  if (typeof dir !== 'string' || !dir) throw new Error('workspace lock directory is required');

  async function readOwner() {
    let stat = null;
    try { stat = await fs.stat(dir); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    try {
      const value = JSON.parse(await fs.readFile(path.join(dir, OWNER_FILE), 'utf8'));
      return { value, mtimeMs: stat.mtimeMs };
    } catch {
      return { value: null, mtimeMs: stat.mtimeMs };
    }
  }

  async function reclaimIfStale(record) {
    if (!record) return true;
    const owner = record.value;
    if (!SAFE_TOKEN.test(owner?.token)) return false;
    const startedAt = Date.parse(owner?.startedAt);
    const age = now() - (Number.isFinite(startedAt) ? startedAt : record.mtimeMs);
    if (age < staleGraceMs) return false;
    if (Number.isInteger(owner?.pid) && await isProcessAlive(owner.pid)) return false;

    // Every contender that observed this owner uses the SAME destination. The winner leaves the renamed
    // directory as a tombstone, so a loser cannot later rename a newly-created lock out of the way.
    const staleDir = `${dir}.stale.${owner.token}`;
    try {
      await fs.rename(dir, staleDir);
    } catch (error) {
      if (error?.code === 'ENOENT') return true;
      return false;
    }
    return true;
  }

  async function tryAcquire({ operationId = 'workspace-writer' } = {}) {
    await fs.mkdir(path.dirname(dir), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = randomUUID();
      if (!SAFE_TOKEN.test(token)) throw new Error('workspace lock token must be a UUID');
      const owner = { pid, startedAt: new Date(now()).toISOString(), operationId, token };
      try {
        await fs.mkdir(dir, { mode: 0o700 });
        try {
          await fs.writeFile(path.join(dir, OWNER_FILE), `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: 'wx' });
        } catch (error) {
          await fs.rm(dir, { recursive: true, force: true });
          throw error;
        }
        let released = false;
        return {
          owner,
          async release() {
            if (released) return;
            released = true;
            const current = await readOwner();
            if (current?.value?.token === token) await fs.rm(dir, { recursive: true, force: true });
          },
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const record = await readOwner();
        if (!await reclaimIfStale(record)) return null;
      }
    }
    return null;
  }

  async function acquire(owner = {}, options = {}) {
    const limit = options.timeoutMs ?? timeoutMs;
    const started = now();
    while (true) {
      const handle = await tryAcquire(owner);
      if (handle) return handle;
      const current = await readOwner();
      if (now() - started >= limit) {
        throw new Error(`workspace writer lock timed out; held by ${ownerLabel(current?.value)}`);
      }
      await wait(options.retryMs ?? retryMs);
    }
  }

  async function withLock(owner, fn, options) {
    const handle = await acquire(owner, options);
    try { return await fn(handle.owner); } finally { await handle.release(); }
  }

  return { tryAcquire, acquire, withLock, readOwner: async () => (await readOwner())?.value ?? null };
}

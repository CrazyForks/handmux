import crypto from 'node:crypto';

export const WORKSPACE_SCHEMA_VERSION = 1;
const byId = (a, b) => a.id.localeCompare(b.id);
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function canonicalizeSnapshot(input) {
  if (input?.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new Error('unsupported workspace schema');
  const sessions = input.sessions.map((s) => ({ ...s, windowIds: [...s.windowIds] })).sort(byId);
  const windows = input.windows.map((w) => ({ ...w, panes: [...w.panes].sort(byId) })).sort(byId);
  for (const [label, ids] of [
    ['session', sessions.map((x) => x.id)],
    ['window', windows.map((x) => x.id)],
    ['pane', windows.flatMap((w) => w.panes.map((p) => p.id))],
  ]) {
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${label} id`);
  }
  return { ...input, sessions, windows };
}

export function fingerprintSnapshot(input) {
  const { capturedAt, revision, payloadHash, ...payload } = canonicalizeSnapshot(input);
  return hash(payload);
}

export function sealPayload(input) {
  const payload = canonicalizeSnapshot(input);
  return { ...payload, payloadHash: fingerprintSnapshot(payload) };
}

export function validateCheckpoint(input) {
  try {
    if (!input?.id || !input?.archivedAt) throw new Error('missing checkpoint fields');
    const expected = fingerprintSnapshot(input);
    if (input.payloadHash !== expected) throw new Error('checkpoint hash mismatch');
    return { ok: true, value: canonicalizeSnapshot(input) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

import crypto from 'node:crypto';

export const WORKSPACE_SCHEMA_VERSION = 1;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byLink = (a, b) => a.index - b.index || (a.windowId < b.windowId ? -1 : a.windowId > b.windowId ? 1 : 0);
const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`${label} must be a non-empty string`);
}

function requireIndex(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
}

function validateShape(input) {
  requireString(input.capturedAt, 'capturedAt');
  requireObject(input.environment, 'environment');
  for (const field of ['id', 'bootIdentity']) requireString(input.environment[field], `environment.${field}`);
  if (input.environment.tmuxServerId !== null) requireString(input.environment.tmuxServerId, 'environment.tmuxServerId');
  requireString(input.tmuxVersion, 'tmuxVersion');
  requireArray(input.sessions, 'sessions');
  requireArray(input.windows, 'windows');
  const empty = input.sessions.length === 0 && input.windows.length === 0;
  if ((input.sessions.length === 0) !== (input.windows.length === 0)) throw new Error('sessions and windows must both be empty or non-empty');
  if (empty) {
    if (input.active !== null) throw new Error('active must be null for an empty workspace');
  } else {
    requireString(input.environment.tmuxServerId, 'environment.tmuxServerId');
    requireObject(input.active, 'active');
    for (const field of ['sessionId', 'windowId', 'paneId']) requireString(input.active[field], `active.${field}`);
  }

  for (const [index, session] of input.sessions.entries()) {
    const label = `sessions[${index}]`;
    requireObject(session, label);
    for (const field of ['id', 'runtimeId', 'name', 'activeWindowId']) requireString(session[field], `${label}.${field}`);
    if (session.windowIds !== undefined) throw new Error(`${label}.windowIds is unsupported; use windowLinks`);
    requireArray(session.windowLinks, `${label}.windowLinks`);
    for (const [linkIndex, link] of session.windowLinks.entries()) {
      const linkLabel = `${label}.windowLinks[${linkIndex}]`;
      requireObject(link, linkLabel);
      requireString(link.windowId, `${linkLabel}.windowId`);
      requireIndex(link.index, `${linkLabel}.index`);
    }
  }

  for (const [windowIndex, window] of input.windows.entries()) {
    const label = `windows[${windowIndex}]`;
    requireObject(window, label);
    for (const field of ['id', 'runtimeId', 'name', 'layout', 'activePaneId']) requireString(window[field], `${label}.${field}`);
    requireIndex(window.index, `${label}.index`);
    requireArray(window.panes, `${label}.panes`);
    for (const [paneIndex, pane] of window.panes.entries()) {
      const paneLabel = `${label}.panes[${paneIndex}]`;
      requireObject(pane, paneLabel);
      for (const field of ['id', 'runtimeId', 'cwd']) requireString(pane[field], `${paneLabel}.${field}`);
      requireIndex(pane.index, `${paneLabel}.index`);
      if (pane.agent !== undefined && pane.agent !== null) requireObject(pane.agent, `${paneLabel}.agent`);
    }
  }
}

function validateReferences(input, sessions, windows) {
  if (sessions.length === 0) return;
  const windowsById = new Map(windows.map((window) => [window.id, window]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  for (const session of sessions) {
    const windowIds = session.windowLinks.map((link) => link.windowId);
    const windowIndexes = session.windowLinks.map((link) => link.index);
    if (new Set(windowIds).size !== windowIds.length) throw new Error(`duplicate window link in session ${session.id}`);
    if (new Set(windowIndexes).size !== windowIndexes.length) throw new Error(`duplicate window link index in session ${session.id}`);
    for (const { windowId } of session.windowLinks) {
      if (!windowsById.has(windowId)) throw new Error(`dangling windowLinks reference ${windowId}`);
    }
    if (!windowIds.includes(session.activeWindowId)) throw new Error(`dangling activeWindowId reference ${session.activeWindowId}`);
  }

  for (const window of windows) {
    if (!window.panes.some((pane) => pane.id === window.activePaneId)) throw new Error(`dangling activePaneId reference ${window.activePaneId}`);
  }

  const activeSession = sessionsById.get(input.active.sessionId);
  if (!activeSession) throw new Error(`dangling active.sessionId reference ${input.active.sessionId}`);
  if (!activeSession.windowLinks.some((link) => link.windowId === input.active.windowId)) throw new Error(`dangling active.windowId reference ${input.active.windowId}`);
  const activeWindow = windowsById.get(input.active.windowId);
  if (!activeWindow?.panes.some((pane) => pane.id === input.active.paneId)) throw new Error(`dangling active.paneId reference ${input.active.paneId}`);
}

export function canonicalizeSnapshot(input) {
  if (input?.schemaVersion !== WORKSPACE_SCHEMA_VERSION) throw new Error('unsupported workspace schema');
  validateShape(input);
  const sessions = input.sessions.map((s) => ({ ...s, windowLinks: s.windowLinks.map((link) => ({ ...link })).sort(byLink) })).sort(byId);
  const windows = input.windows.map((w) => ({ ...w, panes: [...w.panes].sort(byId) })).sort(byId);
  for (const [label, ids] of [
    ['session', sessions.map((x) => x.id)],
    ['window', windows.map((x) => x.id)],
    ['pane', windows.flatMap((w) => w.panes.map((p) => p.id))],
  ]) {
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${label} id`);
  }
  validateReferences(input, sessions, windows);
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
    requireString(input?.id, 'checkpoint id');
    requireString(input?.archivedAt, 'checkpoint archivedAt');
    if (typeof input?.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.payloadHash)) throw new Error('invalid checkpoint payloadHash');
    const expected = fingerprintSnapshot(input);
    if (input.payloadHash !== expected) throw new Error('checkpoint hash mismatch');
    return { ok: true, value: canonicalizeSnapshot(input) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

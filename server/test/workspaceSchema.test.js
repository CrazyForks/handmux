import { describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/workspace/paths.js';
import { canonicalizeSnapshot, fingerprintSnapshot, sealPayload, validateCheckpoint } from '../src/workspace/schema.js';

const pane = (id, index = 0) => ({ id, runtimeId: `%${index + 1}`, index, cwd: `/work/${id}`, agent: null });
const base = {
  schemaVersion: 1,
  capturedAt: '2026-07-20T01:00:00.000Z',
  environment: { id: 'env-a', bootIdentity: 'boot-a', tmuxServerId: 'server-a' },
  tmuxVersion: '3.6a',
  active: { sessionId: 's-Z', windowId: 'w-Z', paneId: 'p-Z' },
  sessions: [
    { id: 's-Z', runtimeId: '$1', name: 'api', windowLinks: [{ windowId: 'w-a', index: 4 }, { windowId: 'w-Z', index: 1 }], activeWindowId: 'w-Z' },
    { id: 's-a', runtimeId: '$2', name: 'web', windowLinks: [{ windowId: 'w-a', index: 1 }], activeWindowId: 'w-a' },
  ],
  windows: [
    { id: 'w-Z', runtimeId: '@1', name: 'main', index: 0, layout: 'layout-Z', activePaneId: 'p-Z', panes: [pane('p-Z'), pane('p-a', 1)] },
    { id: 'w-a', runtimeId: '@2', name: 'client', index: 1, layout: 'layout-a', activePaneId: 'p-b', panes: [pane('p-b', 2)] },
  ],
};
const empty = {
  ...base,
  environment: { ...base.environment, tmuxServerId: null },
  tmuxVersion: 'unknown',
  active: null,
  sessions: [],
  windows: [],
};

describe('workspace schema', () => {
  it('keeps real runtime ordering out of the canonical fingerprint and uses code-point order', () => {
    const shuffled = {
      ...base,
      sessions: [...base.sessions].reverse().map((session) => ({ ...session, windowLinks: [...session.windowLinks].reverse() })),
      windows: [...base.windows].reverse().map((window) => ({ ...window, panes: [...window.panes].reverse() })),
    };
    expect(fingerprintSnapshot(shuffled)).toBe(fingerprintSnapshot(base));
    const canonical = canonicalizeSnapshot(shuffled);
    expect(canonical.sessions.map((session) => session.id)).toEqual(['s-Z', 's-a']);
    expect(canonical.sessions[0].windowLinks).toEqual([{ windowId: 'w-Z', index: 1 }, { windowId: 'w-a', index: 4 }]);
    expect(canonical.windows.map((window) => window.id)).toEqual(['w-Z', 'w-a']);
    expect(canonical.windows[0].panes.map((item) => item.id)).toEqual(['p-Z', 'p-a']);
  });

  it('rejects duplicate logical ids and a bad payload hash', () => {
    const duplicate = {
      ...base,
      active: { ...base.active, paneId: 'p-a' },
      windows: [{ ...base.windows[0], activePaneId: 'p-a', panes: [pane('p-a'), pane('p-a', 1)] }, base.windows[1]],
    };
    expect(() => canonicalizeSnapshot(duplicate)).toThrow(/duplicate pane id/);
    expect(validateCheckpoint({ ...base, id: 'cp-a', archivedAt: base.capturedAt, payloadHash: 'bad' }).ok).toBe(false);
  });

  it('strictly validates required snapshot fields and field types', () => {
    for (const field of ['capturedAt', 'environment', 'active']) {
      const invalid = { ...base };
      delete invalid[field];
      expect(() => canonicalizeSnapshot(invalid)).toThrow(new RegExp(field));
    }
    expect(() => canonicalizeSnapshot({ ...base, tmuxVersion: 36 })).toThrow(/tmuxVersion/);
    expect(() => canonicalizeSnapshot({ ...base, environment: { ...base.environment, id: 42 } })).toThrow(/environment\.id/);
    expect(() => canonicalizeSnapshot({ ...base, active: { ...base.active, paneId: null } })).toThrow(/active\.paneId/);
    expect(() => canonicalizeSnapshot({ ...base, sessions: 'invalid' })).toThrow(/sessions/);
    expect(() => canonicalizeSnapshot({ ...base, sessions: [{ ...base.sessions[0], windowLinks: 'w-Z' }, base.sessions[1]] })).toThrow(/windowLinks/);
    expect(() => canonicalizeSnapshot({ ...base, sessions: [{ ...base.sessions[0], windowLinks: [{ windowId: 'w-Z', index: '1' }] }, base.sessions[1]] })).toThrow(/index/);
    expect(() => canonicalizeSnapshot({ ...base, windows: [{ ...base.windows[0], index: '0' }, base.windows[1]] })).toThrow(/index/);
    expect(() => canonicalizeSnapshot({ ...base, windows: [{ ...base.windows[0], panes: 'invalid' }, base.windows[1]] })).toThrow(/panes/);
    expect(() => canonicalizeSnapshot({ ...base, windows: [{ ...base.windows[0], panes: [{ ...base.windows[0].panes[0], cwd: 42 }] }, base.windows[1]] })).toThrow(/cwd/);
  });

  it('rejects dangling session, window, pane, and active references', () => {
    const danglingWindow = {
      ...base,
      sessions: [{ ...base.sessions[0], windowLinks: [{ windowId: 'w-missing', index: 0 }] }, base.sessions[1]],
    };
    expect(() => canonicalizeSnapshot(danglingWindow)).toThrow(/windowLinks/);

    const duplicateLink = {
      ...base,
      sessions: [{ ...base.sessions[0], windowLinks: [{ windowId: 'w-Z', index: 0 }, { windowId: 'w-Z', index: 2 }] }, base.sessions[1]],
    };
    expect(() => canonicalizeSnapshot(duplicateLink)).toThrow(/duplicate window link/);

    const duplicateIndex = {
      ...base,
      sessions: [{ ...base.sessions[0], windowLinks: [{ windowId: 'w-Z', index: 0 }, { windowId: 'w-a', index: 0 }] }, base.sessions[1]],
    };
    expect(() => canonicalizeSnapshot(duplicateIndex)).toThrow(/duplicate window link index/);

    const danglingPane = {
      ...base,
      windows: [{ ...base.windows[0], activePaneId: 'p-missing' }, base.windows[1]],
    };
    expect(() => canonicalizeSnapshot(danglingPane)).toThrow(/activePaneId/);

    const danglingActive = { ...base, active: { ...base.active, sessionId: 's-a', windowId: 'w-Z' } };
    expect(() => canonicalizeSnapshot(danglingActive)).toThrow(/active\.windowId/);

    const checkpoint = sealPayload({ ...base, id: 'cp-a', archivedAt: base.capturedAt });
    expect(validateCheckpoint(checkpoint).ok).toBe(true);
    expect(validateCheckpoint({ ...checkpoint, capturedAt: undefined }).error).toMatch(/capturedAt/);
  });

  it('canonicalizes, fingerprints, and seals an explicit empty live state', () => {
    expect(canonicalizeSnapshot(empty)).toEqual(empty);
    expect(fingerprintSnapshot(empty)).toMatch(/^[0-9a-f]{64}$/);
    const checkpoint = sealPayload({ ...empty, id: 'cp-empty', archivedAt: empty.capturedAt });
    expect(validateCheckpoint(checkpoint)).toMatchObject({ ok: true });
  });

  it('rejects inconsistent empty and non-empty live-state combinations', () => {
    expect(() => canonicalizeSnapshot({ ...base, sessions: [] })).toThrow(/sessions and windows/);
    expect(() => canonicalizeSnapshot({ ...base, windows: [] })).toThrow(/sessions and windows/);
    expect(() => canonicalizeSnapshot({ ...empty, active: base.active })).toThrow(/active must be null/);
    expect(() => canonicalizeSnapshot({ ...base, active: null })).toThrow(/active must be an object/);
    expect(() => canonicalizeSnapshot({ ...base, environment: { ...base.environment, tmuxServerId: null } })).toThrow(/tmuxServerId/);
    expect(() => canonicalizeSnapshot({ ...empty, environment: { ...empty.environment, tmuxServerId: '' } })).toThrow(/tmuxServerId/);
  });

  it('places all private files below ~/.handmux/workspaces', () => {
    const { root, ...privatePaths } = workspacePaths('/home/me');
    expect(root).toBe('/home/me/.handmux/workspaces');
    for (const value of Object.values(privatePaths)) expect(value.startsWith(`${root}/`)).toBe(true);
  });
});

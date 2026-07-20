import { describe, expect, it } from 'vitest';
import { workspacePaths } from '../src/workspace/paths.js';
import { canonicalizeSnapshot, fingerprintSnapshot, validateCheckpoint } from '../src/workspace/schema.js';

const pane = (id, index = 0) => ({ id, runtimeId: `%${index + 1}`, index, cwd: `/work/${id}`, agent: null });
const base = {
  schemaVersion: 1,
  capturedAt: '2026-07-20T01:00:00.000Z',
  environment: { id: 'env-a', bootIdentity: 'boot-a', tmuxServerId: 'server-a' },
  tmuxVersion: '3.6a',
  active: { sessionId: 's-a', windowId: 'w-a', paneId: 'p-a' },
  sessions: [{ id: 's-a', runtimeId: '$1', name: 'api', windowIds: ['w-a'], activeWindowId: 'w-a' }],
  windows: [{ id: 'w-a', runtimeId: '@1', name: 'main', index: 0, layout: 'layout-a', activePaneId: 'p-a', panes: [pane('p-a')] }],
};

describe('workspace schema', () => {
  it('keeps runtime ordering out of the canonical fingerprint', () => {
    const shuffled = { ...base, sessions: [...base.sessions].reverse(), windows: [...base.windows].reverse() };
    expect(fingerprintSnapshot(shuffled)).toBe(fingerprintSnapshot(base));
  });

  it('rejects duplicate logical ids and a bad payload hash', () => {
    const duplicate = { ...base, windows: [{ ...base.windows[0], panes: [pane('p-a'), pane('p-a', 1)] }] };
    expect(() => canonicalizeSnapshot(duplicate)).toThrow(/duplicate pane id/);
    expect(validateCheckpoint({ ...base, id: 'cp-a', archivedAt: base.capturedAt, payloadHash: 'bad' }).ok).toBe(false);
  });

  it('places all private files below ~/.handmux/workspaces', () => {
    expect(workspacePaths('/home/me').root).toBe('/home/me/.handmux/workspaces');
    expect(workspacePaths('/home/me').liveCurrent).toMatch(/live\/current\.json$/);
  });
});

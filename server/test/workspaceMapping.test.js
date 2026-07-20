import { describe, expect, it } from 'vitest';
import { buildRecoveryMapping, validateRecoveryMapping } from '../src/workspace/mapping.js';

const IDS = {
  session: '00000000-0000-4000-8000-000000000001',
  window: '00000000-0000-4000-8000-000000000002',
  pane: '00000000-0000-4000-8000-000000000003',
};

function additions() {
  return {
    names: { api: 'api-restored' },
    runtime: { sessions: { '$1': '$9' }, windows: { '@1': '@9' }, panes: { '%1': '%9' } },
    logical: { sessions: { [IDS.session]: '$9' }, windows: { [IDS.window]: '@9' }, panes: { [IDS.pane]: '%9' } },
  };
}

describe('workspace recovery mapping validation', () => {
  it('derives a stable sha256 id from canonical checkpoint/name/runtime/logical content', () => {
    const first = buildRecoveryMapping('cp-a', null, [additions()], () => 1_000);
    const reordered = additions();
    reordered.names = { api: 'api-restored' };
    const second = buildRecoveryMapping('cp-a', null, [reordered], () => 2_000);
    expect(first.id).toMatch(/^[0-9a-f]{64}$/);
    expect(first.id).toBe(second.id);
    expect(first.restoredAt).not.toBe(second.restoredAt);
    expect(validateRecoveryMapping(first, 'cp-a')).toEqual(first);
  });

  it.each([
    ['id', (mapping) => { mapping.id = '0'.repeat(64); }],
    ['checkpoint', (mapping) => { mapping.checkpointId = 'cp-other'; }],
    ['runtime key', (mapping) => { mapping.runtime.sessions = { '1': '$9' }; }],
    ['runtime value', (mapping) => { mapping.runtime.panes = { '%1': '%9;rm' }; }],
    ['logical key', (mapping) => { mapping.logical.windows = { 'not-uuid': '@9' }; }],
    ['name primitive', (mapping) => { mapping.names.api = { value: 'api-restored' }; }],
    ['plain records', (mapping) => { mapping.runtime.sessions = new Date(); }],
    ['extra field', (mapping) => { mapping.command = 'rm -rf'; }],
  ])('fails closed on a corrupted %s', (_label, mutate) => {
    const mapping = structuredClone(buildRecoveryMapping('cp-a', null, [additions()], () => 1_000));
    mutate(mapping);
    expect(() => validateRecoveryMapping(mapping, 'cp-a')).toThrow(/recovery mapping/i);
  });
});

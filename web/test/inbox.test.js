import { describe, it, expect } from 'vitest';
import { inboxRows, topView, maxTs, relTime, VIEW_LABEL, viewCounts } from '../src/inbox.js';

const states = {
  '%1': { session: 'a', window: '@1', windowName: 'edit', kind: 'permission', msg: '', ts: 100 },
  '%2': { session: 'a', window: '@2', windowName: 'run', kind: 'working', msg: 'build it', ts: 200 },
  '%3': { session: 'a', window: '@3', windowName: 'old', kind: 'done', msg: 'older', ts: 50 },
  '%4': { session: 'a', window: '@4', windowName: 'new', kind: 'done', msg: 'fresh', ts: 300 },
  '%5': { session: 'b', window: '@9', windowName: 'log', kind: 'idle', msg: 'waited', ts: 90 },
};

describe('inboxRows view mapping + rows', () => {
  it('maps kinds to views (idle→done, permission→needs) and carries fields', () => {
    const rows = inboxRows(states, {}, 0);
    const byPane = Object.fromEntries(rows.map((r) => [r.pane, r.view]));
    expect(byPane).toEqual({ '%1': 'needs', '%2': 'working', '%3': 'done', '%4': 'done', '%5': 'done' });
    expect(rows.find((r) => r.pane === '%2')).toMatchObject({ session: 'a', window: '@2', windowName: 'run', msg: 'build it', ts: 200 });
  });
  it('compacting reads as 进行中 (busy); error stays OUT of the inbox (chat-lens only)', () => {
    const rows = inboxRows({
      '%1': { session: 'a', window: '@1', windowName: 'w', kind: 'compacting', ts: 10 },
      '%2': { session: 'a', window: '@2', windowName: 'w', kind: 'error', msg: '服务过载', ts: 20 },
    }, {}, 0);
    const byPane = Object.fromEntries(rows.map((r) => [r.pane, r.view]));
    expect(byPane['%1']).toBe('working');   // compaction is a busy state
    expect(byPane['%2']).toBeUndefined();   // error is not surfaced in the inbox
  });
  it('threads the agent id (defaults to claude for untagged legacy entries)', () => {
    const rows = inboxRows({
      '%1': { session: 'a', window: '@1', windowName: 'w', kind: 'working', ts: 1, agent: 'codex' },
      '%2': { session: 'a', window: '@2', windowName: 'w', kind: 'working', ts: 1 }, // no agent → claude
    }, {}, 0);
    expect(rows.find((r) => r.pane === '%1').agent).toBe('codex');
    expect(rows.find((r) => r.pane === '%2').agent).toBe('claude');
  });
  it('sorts by session, then needs>done>working, then ts desc', () => {
    expect(inboxRows(states, {}, 0).map((r) => r.pane)).toEqual(['%1', '%4', '%3', '%2', '%5']);
  });
});

describe('done history filter (working/needs never filtered)', () => {
  it('hides done with ts <= readTs, keeps ts > readTs', () => {
    const rows = inboxRows(states, {}, 100);
    const panes = rows.map((r) => r.pane);
    expect(panes).toContain('%4');
    expect(panes).not.toContain('%3');
    expect(panes).not.toContain('%5');
    expect(panes).toContain('%1');
    expect(panes).toContain('%2');
  });
  it('per-pane seen also hides a done even below readTs', () => {
    const rows = inboxRows(states, { '%4': 300 }, 0);
    expect(rows.map((r) => r.pane)).not.toContain('%4');
  });
  it('effective cutoff is max(readTs, seen[pane])', () => {
    const rows = inboxRows(states, { '%4': 250 }, 0);
    expect(rows.map((r) => r.pane)).toContain('%4');
  });
});

describe('topView (topbar dot priority)', () => {
  const row = (view) => ({ pane: '%x', session: 's', window: '@1', windowName: 'w', view, msg: '', ts: 1 });
  it('returns the highest-priority view present: needs > done > working', () => {
    expect(topView([row('working'), row('done'), row('needs')])).toBe('needs');
    expect(topView([row('working'), row('done')])).toBe('done');
    expect(topView([row('working')])).toBe('working');
  });
  it('returns null for an empty roster', () => {
    expect(topView([])).toBeNull();
  });
  it('reflects the filtered roster — a history-suppressed done does not light up', () => {
    // %3/%5 are done with ts below readTs=100, so the roster is needs(%1)+working(%2)+done(%4 ts300).
    expect(topView(inboxRows(states, {}, 100))).toBe('needs');
    // drop the needs pane: highest remaining is the fresh done.
    const noNeeds = { '%2': states['%2'], '%4': states['%4'] };
    expect(topView(inboxRows(noNeeds, {}, 100))).toBe('done');
  });
});

describe('maxTs', () => {
  it('maxTs is the largest ts across all panes', () => {
    expect(maxTs(states)).toBe(300);
    expect(maxTs({})).toBe(0);
  });
});

describe('viewCounts (inbox header summary)', () => {
  it('counts the already-filtered rows per view (已完成 matches the dones actually shown)', () => {
    // readTs=100 → done shows only ts>100: %4 (300) yes, %3 (50)/%5 idle (90) no. needs/working unfiltered.
    expect(viewCounts(inboxRows(states, {}, 100))).toEqual({ working: 1, done: 1, needs: 1 });
  });
  it('an empty roster is all zeros', () => {
    expect(viewCounts([])).toEqual({ working: 0, done: 0, needs: 0 });
  });
});

describe('relTime + VIEW_LABEL', () => {
  it('VIEW_LABEL maps views to Chinese', () => {
    expect(VIEW_LABEL).toEqual({ working: '进行中', done: '已完成', needs: '需要你' });
  });
  it('relTime formats; empty for falsy ts', () => {
    expect(relTime(0, 1000)).toBe('');
    expect(relTime(1000, 1000 + 5_000)).toBe('5秒前');
    expect(relTime(1000, 1000 + 120_000)).toBe('2分钟前');
  });
});

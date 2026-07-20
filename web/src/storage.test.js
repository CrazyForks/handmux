import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyWorkspaceRestoreMapping,
  getBoundSessions,
  getWorkspacePromptState,
  ignoreWorkspaceCheckpoint,
  markWorkspaceAutoShown,
} from './storage.js';

const read = (key) => JSON.parse(localStorage.getItem(key));

beforeEach(() => localStorage.clear());

describe('workspace prompt state', () => {
  it('keeps auto-shown and ignored state scoped to one checkpoint', () => {
    markWorkspaceAutoShown('checkpoint-a');
    expect(getWorkspacePromptState('checkpoint-a')).toEqual({ autoShown: true });
    expect(getWorkspacePromptState('checkpoint-b')).toEqual({});

    ignoreWorkspaceCheckpoint('checkpoint-b');
    expect(getWorkspacePromptState('checkpoint-a')).toEqual({ autoShown: true });
    expect(getWorkspacePromptState('checkpoint-b')).toEqual({ ignored: true, autoShown: true });
  });

  it('closing only marks autoShown and does not silently ignore the checkpoint', () => {
    markWorkspaceAutoShown('checkpoint-a');
    expect(getWorkspacePromptState('checkpoint-a')).toEqual({ autoShown: true });
    expect(getWorkspacePromptState('checkpoint-a').ignored).toBeUndefined();
  });
});

describe('workspace runtime mapping', () => {
  it('migrates only known workspace keys and preserves a same-name current binding', () => {
    localStorage.setItem('tw_last_session', '$1');
    localStorage.setItem('tw_win', JSON.stringify({ '$1': '@1', '$current': '@current' }));
    localStorage.setItem('tw_pane', JSON.stringify({ '@1': '%1', '@current': '%current' }));
    localStorage.setItem('tw_git_repos', JSON.stringify({ '@1': ['/repo/@1'], '@current': ['/repo/current'] }));
    localStorage.setItem('tw_git_dirs', JSON.stringify({ '@1': ['/dir/@1'] }));
    localStorage.setItem('tw_browse_dir', JSON.stringify({ '@1': '/browse/@1' }));
    localStorage.setItem('tw_preview_dir', JSON.stringify({ '@1': '/preview/@1' }));
    localStorage.setItem('tw_pane_base', JSON.stringify({ '%1': '/base/%1' }));
    localStorage.setItem('tw_inbox_seen', JSON.stringify({ '%1': 123, '%current': 456 }));
    localStorage.setItem('tw_bound', JSON.stringify(['project', 'current']));
    localStorage.setItem('tw_chat_draft', 'do not replace $1, @1, or %1 here');

    const mapping = {
      id: 'checkpoint-a:mapping-1',
      runtime: {
        sessions: { '$1': '$9' },
        windows: { '@1': '@9' },
        panes: { '%1': '%9' },
      },
      names: { project: 'project-restored' },
    };

    expect(applyWorkspaceRestoreMapping(mapping)).toBe(true);
    expect(localStorage.getItem('tw_last_session')).toBe('$9');
    expect(read('tw_win')).toEqual({ '$9': '@9', '$current': '@current' });
    expect(read('tw_pane')).toEqual({ '@9': '%9', '@current': '%current' });
    expect(read('tw_git_repos')).toEqual({ '@9': ['/repo/@1'], '@current': ['/repo/current'] });
    expect(read('tw_git_dirs')).toEqual({ '@9': ['/dir/@1'] });
    expect(read('tw_browse_dir')).toEqual({ '@9': '/browse/@1' });
    expect(read('tw_preview_dir')).toEqual({ '@9': '/preview/@1' });
    expect(read('tw_pane_base')).toEqual({ '%9': '/base/%1' });
    expect(read('tw_inbox_seen')).toEqual({ '%9': 123, '%current': 456 });
    expect(getBoundSessions()).toEqual(['project', 'current', 'project-restored']);
    expect(localStorage.getItem('tw_chat_draft')).toBe('do not replace $1, @1, or %1 here');

    const snapshot = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .map((key) => [key, localStorage.getItem(key)]),
    );
    expect(applyWorkspaceRestoreMapping(mapping)).toBe(false);
    expect(Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .map((key) => [key, localStorage.getItem(key)]),
    )).toEqual(snapshot);
  });

  it('accepts a later cumulative partial mapping without replay damage', () => {
    localStorage.setItem('tw_win', JSON.stringify({ '$1': '@1', '$2': '@2' }));
    localStorage.setItem('tw_pane', JSON.stringify({ '@1': '%1', '@2': '%2' }));

    expect(applyWorkspaceRestoreMapping({
      id: 'checkpoint-a:partial-1',
      runtime: {
        sessions: { '$1': '$10' },
        windows: { '@1': '@10' },
        panes: { '%1': '%10' },
      },
    })).toBe(true);
    expect(read('tw_win')).toEqual({ '$10': '@10', '$2': '@2' });

    expect(applyWorkspaceRestoreMapping({
      id: 'checkpoint-a:partial-2',
      runtime: {
        sessions: { '$1': '$10', '$2': '$20' },
        windows: { '@1': '@10', '@2': '@20' },
        panes: { '%1': '%10', '%2': '%20' },
      },
    })).toBe(true);
    expect(read('tw_win')).toEqual({ '$10': '@10', '$20': '@20' });
    expect(read('tw_pane')).toEqual({ '@10': '%10', '@20': '%20' });
  });

  it('rejects a mapping without a stable id', () => {
    localStorage.setItem('tw_last_session', '$1');
    expect(applyWorkspaceRestoreMapping({ runtime: { sessions: { '$1': '$9' } } })).toBe(false);
    expect(localStorage.getItem('tw_last_session')).toBe('$1');
  });
});

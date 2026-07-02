import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(new URL('../hooks/handmux-codex-notify.cjs', import.meta.url).pathname);

// Run the notify script as Codex would: argv[2] = the notification JSON, TMUX_PANE + HANDMUX_STATE in env.
function runNotify(state, pane, payload, extraEnv = {}) {
  execFileSync(process.execPath, [SCRIPT, JSON.stringify(payload)], {
    env: { ...process.env, TMUX_PANE: pane, HANDMUX_STATE: state, ...extraEnv },
    stdio: 'ignore',
  });
}

function tmpState() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cxhook-')), 'state.json'); }
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

describe('handmux-codex-notify.cjs', () => {
  it('records a turn-complete as an agent:codex done entry keyed by pane', () => {
    const state = tmpState();
    runNotify(state, '%3', { type: 'agent-turn-complete', 'last-assistant-message': 'built it' });
    expect(read(state)['%3']).toMatchObject({ src: 'turn-complete', agent: 'codex' });
    expect(read(state)['%3'].payload['last-assistant-message']).toBe('built it');
    expect(typeof read(state)['%3'].ts).toBe('number');
  });

  it('keeps panes separate and overwrites only the firing pane', () => {
    const state = tmpState();
    runNotify(state, '%1', { type: 'agent-turn-complete', 'last-assistant-message': 'one' });
    runNotify(state, '%2', { type: 'agent-turn-complete', 'last-assistant-message': 'two' });
    const obj = read(state);
    expect(Object.keys(obj).sort()).toEqual(['%1', '%2']);
    expect(obj['%1'].payload['last-assistant-message']).toBe('one');
    expect(obj['%2'].payload['last-assistant-message']).toBe('two');
  });

  it('does nothing without a tmux pane (no file written)', () => {
    const state = tmpState();
    execFileSync(process.execPath, [SCRIPT, '{}'], { env: { ...process.env, TMUX_PANE: '', HANDMUX_STATE: state }, stdio: 'ignore' });
    expect(fs.existsSync(state)).toBe(false);
  });

  it('ignores notification types other than agent-turn-complete', () => {
    const state = tmpState();
    runNotify(state, '%5', { type: 'something-else' });
    expect(fs.existsSync(state)).toBe(false);
  });
});

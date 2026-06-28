// Runtime state lives in ~/.handmux/ — a single state.json (pids + the live public URL) plus a log
// file the detached supervisor writes to. `home` is injectable so this unit-tests in a temp dir.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export function pocketHome(home = homedir()) { return path.join(home, '.handmux'); }
export function statePath(home) { return path.join(pocketHome(home), 'state.json'); }
export function logPath(home) { return path.join(pocketHome(home), 'handmux.log'); }
export function configPath(home) { return path.join(pocketHome(home), 'config.json'); }

// The hook-maintained Claude state file, on a stable per-user path (survives a global reinstall, unlike
// the package-internal server/data default). The CLI sets this as CLAUDE_STATE_FILE for the server child
// and writes the same path into the hook's env, so both ends read/write one file.
export function claudeStatePath(home) { return path.join(pocketHome(home), 'claude-state.json'); }

// Push subscriptions and the dynamic-preview registry are mutable runtime data too, so they belong on the
// same stable per-user path — NOT the package-internal server/data default, which a `npm i -g handmux`
// reinstall replaces (silently dropping every saved subscription). The CLI injects these as PUSH_STORE /
// PREVIEW_STORE for the server child.
export function pushStorePath(home) { return path.join(pocketHome(home), 'push-subs.json'); }
export function previewStorePath(home) { return path.join(pocketHome(home), 'previews.json'); }

export function readState(home) {
  try { return JSON.parse(fs.readFileSync(statePath(home), 'utf8')); } catch { return null; }
}

export function writeState(state, home) {
  fs.mkdirSync(pocketHome(home), { recursive: true });
  fs.writeFileSync(statePath(home), JSON.stringify(state, null, 2));
}

export function clearState(home) {
  try { fs.unlinkSync(statePath(home)); } catch { /* already gone */ }
}

// pid liveness without sending a real signal: kill(pid, 0) throws ESRCH if dead, EPERM if alive but
// not ours (still counts as running).
export function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

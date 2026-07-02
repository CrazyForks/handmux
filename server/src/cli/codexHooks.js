// Install/uninstall the handmux Codex `notify` hook — the Codex analogue of claudeHooks.js. Codex's ONLY
// extension point is a single `notify` program in ~/.codex/config.toml (fired on agent-turn-complete), so
// this is much smaller than the Claude side: no per-event matchers, no settings-array merge.
//
// The two Codex-specific frictions this handles:
//  1. TOML, not JSON, and `notify` is a SINGLE root key (must appear before any [table]) — so we edit lines
//     textually rather than parse/serialize TOML (no dependency), touching only the one `notify` line.
//  2. Codex allows exactly one `notify`. If the user already has their own (e.g. a chime), we must NOT
//     clobber it: we detect a foreign notify and report 'conflict' instead of overwriting.
//
// Iron rule (same as Claude): only ever touch ~/.handmux/ and — after explicit opt-in — ~/.codex/. If
// ~/.codex is absent (no Codex CLI), skip and report 'no-codex'; never create it.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

const CODEX_MARK = 'handmux-codex-notify'; // our notify script's basename — identifies our line among the user's
const SCRIPT = 'handmux-codex-notify.cjs';

function codexDir(home = homedir()) { return path.join(home, '.codex'); }
function configPath(home = homedir()) { return path.join(codexDir(home), 'config.toml'); }
function hooksDir(home = homedir()) { return path.join(codexDir(home), 'hooks'); }

// Index of the root-level `notify = …` line (before the first [table] header), or -1. TOML requires root
// keys to precede tables, so a `notify` under some [table] is a different key and we leave it alone.
function rootNotifyIndex(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) return -1;   // hit a table before any root notify
    if (/^\s*notify\s*=/.test(lines[i])) return i;
  }
  return -1;
}

// Pure: return { text, conflict }. Sets our notify line, idempotently. If a foreign notify already occupies
// the root slot, return { conflict:true, text:null } and let the caller refuse (don't clobber the user's).
export function mergeCodexNotify(toml, notifyLine) {
  const text = toml || '';
  const lines = text.split('\n');
  const i = rootNotifyIndex(lines);
  if (i >= 0) {
    if (!lines[i].includes(CODEX_MARK)) return { conflict: true, text: null };
    lines[i] = notifyLine;                    // ours already → refresh the path (idempotent)
    return { conflict: false, text: lines.join('\n') };
  }
  return { conflict: false, text: notifyLine + '\n' + text }; // none → prepend (root key before any table)
}

// Pure: remove our notify line (only if it's ours), leaving a foreign notify untouched.
export function stripCodexNotify(toml) {
  const lines = (toml || '').split('\n');
  const i = rootNotifyIndex(lines);
  if (i >= 0 && lines[i].includes(CODEX_MARK)) lines.splice(i, 1);
  return lines.join('\n');
}

// The notify line we write: [<this node binary>, <abs path to our script>]. Pinning process.execPath means
// the hook runs under the same Node handmux uses, regardless of what's on Codex's PATH. JSON.stringify emits
// a valid TOML inline array of basic strings (same escaping), so odd chars in the paths stay safe.
function notifyLineFor(home) {
  return `notify = ${JSON.stringify([process.execPath, path.join(hooksDir(home), SCRIPT)])}`;
}

function readConf(home) {
  try { return fs.readFileSync(configPath(home), 'utf8'); } catch { return ''; }
}

// 'no-codex' → ~/.codex absent (don't prompt). 'installed' → our notify present. 'conflict' → a foreign
// notify holds the slot. 'absent' → Codex present, no notify wired.
export function codexHooksStatus(home = homedir()) {
  if (!fs.existsSync(codexDir(home))) return 'no-codex';
  const lines = readConf(home).split('\n');
  const i = rootNotifyIndex(lines);
  if (i < 0) return 'absent';
  return lines[i].includes(CODEX_MARK) ? 'installed' : 'conflict';
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// Install (opt-in): copy the notify script into ~/.codex/hooks/, write the env pointing at the shared state
// file, and set the `notify` key in config.toml. NEVER creates ~/.codex. Returns { status }:
//   'no-codex' (nothing to do) | 'conflict' (user has their own notify — we refuse) | 'installed'.
export function installCodexHooks(home = homedir(), { srcDir, stateFile } = {}) {
  if (!fs.existsSync(codexDir(home))) return { status: 'no-codex' };
  const merged = mergeCodexNotify(readConf(home), notifyLineFor(home));
  if (merged.conflict) return { status: 'conflict' };

  fs.mkdirSync(hooksDir(home), { recursive: true });
  fs.copyFileSync(path.join(srcDir, SCRIPT), path.join(hooksDir(home), SCRIPT));
  fs.chmodSync(path.join(hooksDir(home), SCRIPT), 0o755);
  fs.writeFileSync(path.join(hooksDir(home), 'handmux-codex-notify.env'), `HANDMUX_STATE=${stateFile}\n`, { mode: 0o600 });
  writeAtomic(configPath(home), merged.text);
  return { status: 'installed' };
}

// Uninstall: strip our notify line (leaving a foreign one) and remove the copied script/env. Best-effort.
export function uninstallCodexHooks(home = homedir()) {
  if (fs.existsSync(configPath(home))) writeAtomic(configPath(home), stripCodexNotify(readConf(home)));
  for (const f of [SCRIPT, 'handmux-codex-notify.env']) {
    try { fs.unlinkSync(path.join(hooksDir(home), f)); } catch { /* already gone */ }
  }
  return { status: 'absent' };
}

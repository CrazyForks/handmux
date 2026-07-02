#!/usr/bin/env node
// handmux Codex notify program. Wired via ~/.codex/config.toml:  notify = ["<node>", "<this file>"].
// Codex spawns it with ONE argv — the notification JSON — on `agent-turn-complete` (its only notify event).
// We record the pane's latest state into the SHARED handmux state file (the same one the Claude hook and the
// server use), keyed by tmux pane, tagged agent:'codex' so the server classifies it with the Codex driver.
//
// .cjs (not .js): runs standalone via `node <file>` from ~/.codex/hooks (no package.json) — .cjs forces
// CommonJS so require() works. Best-effort + always exit 0: a notify program must never fail Codex.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// HANDMUX_STATE from the .env we wrote next to this script — Codex does NOT pass handmux's env through, so
// (unlike a shell hook that can read the environment) we persist the path at install time and read it here.
function stateFile() {
  try {
    const env = fs.readFileSync(path.join(__dirname, 'handmux-codex-notify.env'), 'utf8');
    const m = env.match(/^HANDMUX_STATE=(.*)$/m);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* fall through to defaults */ }
  return process.env.HANDMUX_STATE || path.join(os.homedir(), '.handmux', 'claude-state.json');
}

const pane = process.env.TMUX_PANE;
if (!pane) process.exit(0); // not in tmux → no pane to key on

let payload = {};
try { payload = JSON.parse(process.argv[2] || '{}'); } catch { /* unparseable → {} */ }
// Only the turn-complete event is actionable; ignore any future notification types we don't classify.
if (payload && payload.type && payload.type !== 'agent-turn-complete') process.exit(0);

const file = stateFile();
const ts = Date.now();
let host = ''; try { host = os.hostname(); } catch { /* ignore */ }

// Synchronous nap without busy-spinning (falls back to a tiny busy loop if SharedArrayBuffer is unavailable).
const nap = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* spin */ } }
};

try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }

// Read-modify-write the single JSON object so this pane's entry doesn't clobber other panes'. Many Codex
// panes can finish turns concurrently, so take a short O_EXCL lock (stealing a stale one) and replace
// atomically — identical discipline to handmux-write.cjs.
function update() {
  let obj = {};
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) obj = j; }
  catch { /* fresh / corrupt / half-written → start clean */ }
  obj[pane] = { ts, src: 'turn-complete', host, payload, agent: 'codex' };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file); // atomic: a torn write can't corrupt the file
}

const lock = `${file}.lock`;
let held = false;
for (let i = 0; i < 60 && !held; i++) {
  try { fs.closeSync(fs.openSync(lock, 'wx')); held = true; }
  catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 3000) fs.unlinkSync(lock); } catch { /* steal a stale lock */ }
    nap(15);
  }
}
try { update(); } catch { /* best effort */ }
if (held) { try { fs.unlinkSync(lock); } catch { /* ignore */ } }

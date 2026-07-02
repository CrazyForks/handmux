#!/usr/bin/env node
// handmux hook writer. Updates ONE JSON state file keyed by tmux pane id with this pane's latest
// Claude event:  { "%pane": { ts, src, host, payload }, ... }.  Invoked by handmux-notify.sh:
//   node handmux-write.cjs <file> <pane> <src> <ts> <host>     (stdin = Claude's raw hook payload JSON)
//
// .cjs (not .js): runs standalone via `node <file>`, including from ~/.claude/hooks (no package.json) —
// .cjs forces CommonJS everywhere; a bare .js under the server tree ("type":"module") would be ESM and
// break require().
//
// Why node (not pure shell): the file is a single JSON object, so each event is a read-modify-write that
// must parse JSON and not clobber other panes — shell can't do that safely. The user runs many Claude
// panes at once, so hooks fire concurrently: we take a short O_EXCL lock (stealing a stale one) around
// the read-modify-write and replace atomically (tmp + rename), so concurrent writers don't lose updates
// or corrupt the file. Best-effort throughout and silent — the hook is fire-and-forget and must never
// fail Claude (the shell wrapper swallows errors and always exits 0).
const fs = require('node:fs');
const path = require('node:path');

const [, , file, pane, src, ts, host = '', agent = ''] = process.argv;
if (!file || !pane || !src) process.exit(0);

let payload = {};
try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { /* unreadable stdin → {} */ }

// idle_prompt ("been idle ~60s") is decided in update() against the pane's PRIOR state: it either trails
// a resting state (done/needs → drop, so it can't bump ts and re-surface an already-cleared 已完成) or it
// terminates an ESC-interrupted working turn (→ clear the stuck 进行中). Flag it here; the read-modify-
// write under the lock — the only place we can read the prior state safely — makes the call.
const isIdle = src === 'notify' && payload && payload.notification_type === 'idle_prompt';
let cleared = false; // set by update() when idle cleared an interrupted 进行中 → also clear @claude_dot below
let noop = false;    // set when a codex PostToolUse resume had nothing to un-stick → skip the state + dot write

// Synchronous nap without busy-spinning (the hook runs async, so a few ms is free). SharedArrayBuffer
// may be unavailable in odd runtimes — fall back to a tiny busy loop so the lock retry still paces.
const nap = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
  catch { const end = Date.now() + ms; while (Date.now() < end) { /* spin */ } }
};

try { fs.mkdirSync(path.dirname(file), { recursive: true }); } catch { /* ignore */ }

function update() {
  let obj = {};
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object' && !Array.isArray(j)) obj = j; }
  catch { /* fresh / corrupt / half-written → start clean */ }
  const prevSrc = obj[pane] && obj[pane].src;
  if (isIdle) {
    // idle after a resting state (done/needs/nothing) is just the "still waiting" reminder → drop and
    // leave the file as it was (recording it would bump ts and re-surface an already-cleared 已完成).
    // idle after a WORKING turn (prompt/resume) that never got a Stop = an ESC interrupt / walk-away —
    // no Stop hook fires there, so idle is the only signal the turn ended. Without this the 进行中 dot
    // sticks forever; treat it as a soft end and clear the pane (and its @claude_dot, below).
    if (prevSrc === 'prompt' || prevSrc === 'resume') { delete obj[pane]; cleared = true; }
    else return;                                             // resting → drop without writing
  } else if (src === 'end') {
    delete obj[pane];                                        // SessionEnd (clean exit) → drop the pane
  } else if (src === 'resume' && agent === 'codex') {
    // Codex fires PostToolUse on EVERY tool call, so its resume exists purely to un-stick a pane from 需要你
    // back to 进行中 after the user approved a PermissionRequest. Apply it ONLY as that transition — a mid-
    // turn tool call (pane already 进行中 / 已完成) is a no-op, so we don't rewrite the entry or repaint the
    // dot on every command (the load Claude's matcher avoids). Claude's resume — no agent arg — is unaffected.
    const prev = obj[pane];
    const prevPerm = prev && (prev.src === 'permreq'
      || (prev.src === 'notify' && (prev.payload || {}).notification_type === 'permission_prompt'));
    if (!prevPerm) { noop = true; return; }
    obj[pane] = { ts: Number(ts) || 0, src, host, payload, agent };
  } else {
    // agent tag lets the server dispatch classify + liveness per agent (Codex passes 'codex'); omitted for
    // Claude so legacy entries stay byte-identical and default to claude server-side.
    obj[pane] = { ts: Number(ts) || 0, src, host, payload, ...(agent ? { agent } : {}) };
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);                                   // atomic: a torn write can't corrupt the file
}

const lock = `${file}.lock`;
let held = false;
for (let i = 0; i < 60 && !held; i++) {                       // ~0.9s budget, then write lockless (best-effort)
  try { fs.closeSync(fs.openSync(lock, 'wx')); held = true; } // O_EXCL → atomic "I hold it"
  catch {
    try { if (Date.now() - fs.statSync(lock).mtimeMs > 3000) fs.unlinkSync(lock); } catch { /* steal a stale lock */ }
    nap(15);
  }
}
try { update(); } catch { /* best effort */ }
if (held) { try { fs.unlinkSync(lock); } catch { /* ignore */ } }

// tmux 页签状态色点（事件驱动）：把本次事件的状态色 markup 写进该 pane 所在窗的 @claude_dot 选项。
// tmux 的 window-status-format 只读 #{@claude_dot}（纯查表、不跑任何 shell），所以稳态零重绘——只有
// 状态真变化（即本 hook 触发的这一刻）才写一次、才重绘一次，不轮询、不卡。详见 tmux/README.md。
// best-effort + 1s 超时：不在 tmux / tmux 不可达都静默忽略，永不阻塞或失败 Claude。
function claudeDot(s, p) {
  if (s === 'stop') return '#[fg=#2e7d46]●#[default] ';                              // 已完成 绿
  if (s === 'prompt' || s === 'resume') return '#[fg=#2f6fed,blink]●#[default] ';   // 进行中 蓝闪
  if (s === 'permreq') return '#[fg=#e0a020]●#[default] ';                           // 需要你 橙
  if (s === 'notify' && p && p.notification_type === 'permission_prompt') return '#[fg=#e0a020]●#[default] ';
  return null; // 其它无法分类 → 不动该窗的点（end 在下方单独清空）
}
try {
  const dot = (src === 'end' || cleared) ? '' : claudeDot(src, payload);
  if (dot !== null && !noop) {
    require('node:child_process').execFileSync('tmux', ['set-option', '-w', '-t', pane, '@claude_dot', dot], { stdio: 'ignore', timeout: 1000 });
  }
} catch { /* 不在 tmux / tmux 不可达 → 忽略 */ }

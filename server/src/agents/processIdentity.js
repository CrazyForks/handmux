import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { normTty } from './scanUtils.js';

const SUCCESS_TTL_MS = 30_000;
const FAILURE_TTL_MS = 3_000;

// Real executable path of a pid. lsof resolves launch symlinks on macOS; /proc is the cheap Linux path.
// A transient lsof failure is inconclusive, not a negative identity verdict that should escape the call.
export async function executablePath(run, pid) {
  let out = '';
  try { out = await run('lsof', ['-a', '-p', String(pid), '-d', 'txt', '-Fn']); } catch { /* try /proc */ }
  for (const line of String(out).split('\n')) if (line[0] === 'n') return line.slice(1).trim();
  try { return await fsp.readlink(`/proc/${pid}/exe`); } catch { return ''; }
}

function parseForegroundProcesses(out) {
  const rows = [];
  for (const line of String(out).split('\n')) {
    const m = line.match(/^\s*(\S+)\s+(\d+)\s+(\S+)\s*$/);
    if (!m) continue;
    const tty = normTty(m[1]);
    if (tty && m[3].includes('+')) rows.push({ tty, pid: m[2] });
  }
  return rows;
}

// Normalize ambiguous tmux pane_current_command values only after tying the pane's TTY to a foreground
// process whose REAL executable proves the agent identity. Every call refreshes the cheap ps snapshot;
// the cache only skips lsof while the exact foreground pid set is unchanged and its short TTL is live.
// This makes TTY reuse/process replacement invalidate immediately, and failed probes retry quickly.
export async function resolveByExecutable(panes, run, verdicts, {
  candidate,
  normalized,
  matches,
  now = () => Date.now(),
  successTtlMs = SUCCESS_TTL_MS,
  failureTtlMs = FAILURE_TTL_MS,
}) {
  const candidates = panes.filter((p) => p && p.tty && candidate(p.cmd || ''));
  if (!candidates.length) return panes;

  const rows = parseForegroundProcesses(await run('ps', ['-Ao', 'tty=,pid=,stat=']));
  for (const pane of candidates) {
    const tty = normTty(pane.tty);
    const procs = rows.filter((r) => r.tty === tty);
    const signature = procs.map((r) => r.pid).sort().join(',');
    const key = `${normalized}|${tty}|${pane.cmd}`;
    const cached = verdicts.get(key);
    if (cached && cached.signature === signature && cached.expiresAt > now()) {
      if (cached.ok) pane.cmd = normalized;
      continue;
    }

    let ok = false;
    let matchedPid = null;
    for (const proc of procs) {
      const exe = await executablePath(run, proc.pid);
      if (matches(exe, pane.cmd)) { ok = true; matchedPid = proc.pid; break; }
    }
    verdicts.set(key, {
      ok,
      pid: matchedPid,
      signature,
      expiresAt: now() + (ok ? successTtlMs : failureTtlMs),
    });
    if (ok) pane.cmd = normalized;
  }
  return panes;
}

export const executableBasename = (file) => path.basename(String(file || ''));

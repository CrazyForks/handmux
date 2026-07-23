// Usage/quota reader for the phone's Usage page. Purely reads what each agent already puts on disk — no
// API calls, no credentials:
//   • Claude — the snapshot the statusLine capturer writes to ~/.handmux/claude-usage.json. Claude Code's
//     statusLine stdin is the ONLY documented local source of the 5h/weekly rate-limit % (see
//     server/hooks/handmux-statusline.cjs). Absent until the user opts the capturer in → returns null.
//   • Codex — the newest `token_count` event across all local sessions, which carries `rate_limits` (used
//     %, reset, window) and cumulative token usage. Available once Codex has emitted one, no wiring needed.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { pocketHome } from './cli/state.js';

export function claudeUsagePath(home = homedir()) { return path.join(pocketHome(home), 'claude-usage.json'); }
export function claudeContextDir(home = homedir()) { return path.join(pocketHome(home), 'context'); }

// Per-session context-window snapshot the statusLine capturer writes to ~/.handmux/context/<sessionId>.json
// ({ model, usedPercent, updatedAt }). null if the capturer isn't wired, the session never rendered, or the
// id is unsafe. Used to show the CURRENT pane's context % (the global claude-usage.json can't — it's one
// last-writer-wins snapshot across all sessions). sessionId is sanitised to keep the read inside the dir.
export function readClaudeContext(sessionId, home = homedir()) {
  if (typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return null;
  try {
    const snap = JSON.parse(fs.readFileSync(path.join(claudeContextDir(home), `${sessionId}.json`), 'utf8'));
    return (snap && typeof snap === 'object' && !Array.isArray(snap)) ? snap : null;
  } catch { return null; }
}
export function codexSessionsDir(home = homedir()) { return path.join(home, '.codex', 'sessions'); }

// Claude: read the statusLine snapshot. null if the capturer isn't wired / never populated it.
export function readClaudeUsage(home = homedir()) {
  try {
    const snap = JSON.parse(fs.readFileSync(claudeUsagePath(home), 'utf8'));
    return (snap && typeof snap === 'object' && !Array.isArray(snap)) ? snap : null;
  } catch { return null; }
}

// Usage is machine-wide, not owned by whichever session happened to be created last. Enumerate rollout
// files by modification time: an active older session can be newer than a freshly-created rollout, while
// a new rollout may have no token_count until its first response. Once a file's mtime is older than the
// newest event already found, no remaining file can contain a newer event, so the scan stays bounded.
function rolloutFilesByMtime(dir) {
  const files = [];
  const visit = (current) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
        try { files.push({ file, mtimeMs: fs.statSync(file).mtimeMs }); } catch { /* file raced away */ }
      }
    }
  };
  visit(dir);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// One Codex rate-limit window → our shape, or null if absent (secondary is often null on plans without it).
function codexWindow(w) {
  if (!w || typeof w.used_percent !== 'number') return null;
  return {
    usedPercent: w.used_percent,
    windowMinutes: typeof w.window_minutes === 'number' ? w.window_minutes : null,
    resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null,
  };
}

// Codex: return the newest token_count event across every local session. A newly-created empty rollout
// does not erase the last machine-wide value; the first event it eventually writes refreshes that value.
export function readCodexUsage(home = homedir()) {
  let latest = null;
  for (const { file, mtimeMs } of rolloutFilesByMtime(codexSessionsDir(home))) {
    if (latest?.updatedAt && mtimeMs < latest.updatedAt) break;
    let lines;
    try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { continue; }
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i];
      if (!ln || ln.indexOf('token_count') === -1) continue;
      let rec; try { rec = JSON.parse(ln); } catch { continue; }
      const p = rec.payload;
      if (!p || p.type !== 'token_count') continue;
      const updatedAt = Date.parse(rec.timestamp) || null;
      if (latest && (!updatedAt || updatedAt <= latest.updatedAt)) break;
      const info = p.info || {};
      const tu = info.total_token_usage || {};
      const rl = p.rate_limits || {};
      latest = {
        updatedAt,
        rateLimits: { primary: codexWindow(rl.primary), secondary: codexWindow(rl.secondary) },
        tokens: {
          total: tu.total_tokens ?? null,
          input: tu.input_tokens ?? null,
          cachedInput: tu.cached_input_tokens ?? null,
          output: tu.output_tokens ?? null,
          reasoning: tu.reasoning_output_tokens ?? null,
        },
        contextWindow: typeof info.model_context_window === 'number' ? info.model_context_window : null,
      };
      break;
    }
  }
  return latest;
}

export function getUsage(home = homedir()) {
  return { claude: readClaudeUsage(home), codex: readCodexUsage(home) };
}

// Small TTL cache so a phone that re-polls doesn't rescan the rollout every few seconds.
let _cache = { at: 0, home: null, data: null };
export function getUsageCached(home = homedir(), { ttlMs = 15000, now = Date.now() } = {}) {
  if (_cache.data && _cache.home === home && (now - _cache.at) < ttlMs) return _cache.data;
  _cache = { at: now, home, data: getUsage(home) };
  return _cache.data;
}

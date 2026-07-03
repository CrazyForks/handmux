// Usage/quota reader for the phone's Usage page. Purely reads what each agent already puts on disk — no
// API calls, no credentials:
//   • Claude — the snapshot the statusLine capturer writes to ~/.handmux/claude-usage.json. Claude Code's
//     statusLine stdin is the ONLY documented local source of the 5h/weekly rate-limit % (see
//     server/hooks/handmux-statusline.cjs). Absent until the user opts the capturer in → returns null.
//   • Codex — the newest rollout's most recent `token_count` event, which carries `rate_limits` (used %,
//     reset, window) and cumulative token usage. Always available once Codex has run, no wiring needed.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { pocketHome } from './cli/state.js';

export function claudeUsagePath(home = homedir()) { return path.join(pocketHome(home), 'claude-usage.json'); }
export function codexSessionsDir(home = homedir()) { return path.join(home, '.codex', 'sessions'); }

// Claude: read the statusLine snapshot. null if the capturer isn't wired / never populated it.
export function readClaudeUsage(home = homedir()) {
  try {
    const snap = JSON.parse(fs.readFileSync(claudeUsagePath(home), 'utf8'));
    return (snap && typeof snap === 'object' && !Array.isArray(snap)) ? snap : null;
  } catch { return null; }
}

// The rollout tree is date-nested (sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl) and every path segment
// sorts lexically = chronologically, so the newest rollout is the lexically-largest entry at each level —
// found without walking the whole tree.
function newestRollout(dir) {
  const maxEntry = (d, pred) => {
    let names;
    try { names = fs.readdirSync(d); } catch { return null; }
    names = names.filter((n) => !n.startsWith('.') && (!pred || pred(n))).sort();
    return names.length ? names[names.length - 1] : null;
  };
  const y = maxEntry(dir); if (!y) return null;
  const m = maxEntry(path.join(dir, y)); if (!m) return null;
  const d = maxEntry(path.join(dir, y, m)); if (!d) return null;
  const dayDir = path.join(dir, y, m, d);
  const f = maxEntry(dayDir, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'));
  return f ? path.join(dayDir, f) : null;
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

// Codex: scan the newest rollout from the end for the last `token_count` event (carries the account-wide
// rate_limits + the session's cumulative tokens). null if Codex hasn't run or the rollout has none yet.
export function readCodexUsage(home = homedir()) {
  const f = newestRollout(codexSessionsDir(home));
  if (!f) return null;
  let lines;
  try { lines = fs.readFileSync(f, 'utf8').split('\n'); } catch { return null; }
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i];
    if (!ln || ln.indexOf('token_count') === -1) continue;
    let rec; try { rec = JSON.parse(ln); } catch { continue; }
    const p = rec.payload;
    if (!p || p.type !== 'token_count') continue;
    const info = p.info || {};
    const tu = info.total_token_usage || {};
    const rl = p.rate_limits || {};
    return {
      updatedAt: Date.parse(rec.timestamp) || null,
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
  }
  return null;
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

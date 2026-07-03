import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpHome } from './tmphome.js';
import {
  readClaudeUsage, readCodexUsage, getUsage, getUsageCached, claudeUsagePath,
} from '../src/usage.js';

// Write a Codex rollout at sessions/YYYY/MM/DD/<name> with the given jsonl lines.
function writeRollout(home, y, m, d, name, lines) {
  const dir = path.join(home, '.codex', 'sessions', y, m, d);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), lines.map((l) => JSON.stringify(l)).join('\n'));
}
const tokenCount = (ts, usedPercent, totals, secondary = null) => ({
  timestamp: ts, type: 'event_msg',
  payload: {
    type: 'token_count',
    info: { total_token_usage: totals, model_context_window: 258400 },
    rate_limits: {
      primary: { used_percent: usedPercent, window_minutes: 43200, resets_at: 1785599998 },
      secondary,
    },
  },
});

describe('readClaudeUsage', () => {
  it('reads the statusLine snapshot; null when missing or garbage', () => {
    const home = tmpHome('usg-');
    expect(readClaudeUsage(home)).toBeNull();
    fs.mkdirSync(path.dirname(claudeUsagePath(home)), { recursive: true });
    fs.writeFileSync(claudeUsagePath(home), JSON.stringify({
      updatedAt: 5, rateLimits: { fiveHour: { usedPercent: 42, resetsAt: 111 }, sevenDay: { usedPercent: 15 } },
    }));
    expect(readClaudeUsage(home)).toMatchObject({ rateLimits: { fiveHour: { usedPercent: 42 } } });
    fs.writeFileSync(claudeUsagePath(home), 'not json');
    expect(readClaudeUsage(home)).toBeNull();
  });
});

describe('readCodexUsage', () => {
  it('null when Codex has never run', () => {
    expect(readCodexUsage(tmpHome('usg-'))).toBeNull();
  });

  it('picks the newest rollout and its LAST token_count (rate_limits + cumulative tokens)', () => {
    const home = tmpHome('usg-');
    // an older day + older file that should be ignored
    writeRollout(home, '2026', '07', '02', 'rollout-2026-07-02T10-00-00-a.jsonl', [
      tokenCount('2026-07-02T10:00:00.000Z', 5, { input_tokens: 1, total_tokens: 1 }),
    ]);
    // newest day, newest file, two token_counts — the LAST one wins
    writeRollout(home, '2026', '07', '03', 'rollout-2026-07-03T00-45-17-z.jsonl', [
      tokenCount('2026-07-03T00:45:00.000Z', 10, { input_tokens: 100, total_tokens: 110 }),
      { timestamp: '2026-07-03T00:45:10.000Z', type: 'response_item', payload: { type: 'x' } },
      tokenCount('2026-07-03T00:45:17.000Z', 16, {
        input_tokens: 21960, cached_input_tokens: 19712, output_tokens: 120, reasoning_output_tokens: 40, total_tokens: 22080,
      }),
    ]);
    const u = readCodexUsage(home);
    expect(u.rateLimits.primary).toEqual({ usedPercent: 16, windowMinutes: 43200, resetsAt: 1785599998 });
    expect(u.rateLimits.secondary).toBeNull();
    expect(u.tokens).toEqual({ total: 22080, input: 21960, cachedInput: 19712, output: 120, reasoning: 40 });
    expect(u.contextWindow).toBe(258400);
    expect(u.updatedAt).toBe(Date.parse('2026-07-03T00:45:17.000Z'));
  });

  it('maps a present secondary window too', () => {
    const home = tmpHome('usg-');
    writeRollout(home, '2026', '07', '03', 'rollout-2026-07-03T01-00-00-s.jsonl', [
      tokenCount('2026-07-03T01:00:00.000Z', 20, { total_tokens: 5 },
        { used_percent: 55, window_minutes: 300, resets_at: 1785600000 }),
    ]);
    expect(readCodexUsage(home).rateLimits.secondary).toEqual({ usedPercent: 55, windowMinutes: 300, resetsAt: 1785600000 });
  });

  it('null when the newest rollout has no token_count', () => {
    const home = tmpHome('usg-');
    writeRollout(home, '2026', '07', '03', 'rollout-2026-07-03T02-00-00-n.jsonl', [
      { timestamp: '2026-07-03T02:00:00.000Z', type: 'session_meta', payload: {} },
    ]);
    expect(readCodexUsage(home)).toBeNull();
  });
});

describe('getUsage / getUsageCached', () => {
  it('bundles both agents (either may be null)', () => {
    const home = tmpHome('usg-');
    const u = getUsage(home);
    expect(u).toEqual({ claude: null, codex: null });
  });

  it('caches within the ttl and refreshes after it', () => {
    const home = tmpHome('usg-');
    const a = getUsageCached(home, { ttlMs: 1000, now: 1000 });
    // add a codex rollout AFTER the first (cached) read
    writeRollout(home, '2026', '07', '03', 'rollout-2026-07-03T03-00-00-c.jsonl', [
      tokenCount('2026-07-03T03:00:00.000Z', 7, { total_tokens: 9 }),
    ]);
    expect(getUsageCached(home, { ttlMs: 1000, now: 1500 })).toBe(a); // still cached → codex null
    expect(getUsageCached(home, { ttlMs: 1000, now: 2500 }).codex).not.toBeNull(); // ttl passed → rescanned
  });
});

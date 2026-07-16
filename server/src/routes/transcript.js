// Read a pane's Claude Code jsonl session and return it as normalized chat messages (the "对话" lens's
// read-projection). Pane → cwd (tmux) → the session file under ~/.claude/projects/<encoded-cwd>/.
// Server-side paginated — the phone must never receive the whole transcript:
//   - Recent window (default + polling): ?pane=&limit=10&since=<hash> — the last `limit` messages, with
//     the same content-hash `since`省流 as /history (unchanged window → 204). `hasMore`/`firstSeq` tell the
//     client whether/where an older page starts.
//   - History page (scroll-up, not polled): ?pane=&before=<k>&limit=10 — the last `limit` messages with
//     `k < before`, no hash.
// `k` = each message's global ordinal from `all.map((m,k)=>({...m,k}))` — stable because the jsonl is
// append-only, so it doubles as the client's dedup key. `limit` clamps to [1,100], default 10. Mounted
// under /api.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isPaneId } from '../tmux/commands.js';
import { projectsDir } from '../agents/claude.js';
import { resolveEncodedDirSession, encodeProjectDir } from '../agents/scanUtils.js';
import { parseTranscript } from '../transcriptParse.js';

export function transcriptRoutes({ commands }) {
  const r = express.Router();
  r.get('/transcript', async (req, res, next) => {
    if (!isPaneId(req.query.pane)) return res.status(400).json({ error: 'bad pane id' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const before = req.query.before != null && req.query.before !== '' ? Number(req.query.before) : null;
    try {
      const cwd = await commands.paneCurrentPath(req.query.pane);
      const dir = projectsDir();
      const resolved = await resolveEncodedDirSession(dir, cwd);
      const empty = { messages: [], hash: '', session: resolved.sessionId || null, hasMore: false, firstSeq: null };
      if (!resolved.sessionId) return res.json(empty);
      const file = path.join(dir, encodeProjectDir(cwd), resolved.sessionId + '.jsonl');
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { return res.json(empty); }
      const all = parseTranscript(text.split('\n')).map((m, k) => ({ ...m, k })); // k = stable global ordinal
      const pool = before == null ? all : all.filter((m) => m.k < before);
      const messages = pool.slice(-limit);
      const firstSeq = messages.length ? messages[0].k : null;
      const hasMore = pool.length > messages.length;
      if (before == null) {
        const hash = createHash('sha1').update(JSON.stringify(messages)).digest('hex').slice(0, 16);
        if (req.query.since === hash) return res.status(204).end();
        return res.json({ messages, hash, session: resolved.sessionId, hasMore, firstSeq });
      }
      return res.json({ messages, session: resolved.sessionId, hasMore, firstSeq });
    } catch (e) { next(e); }
  });
  return r;
}

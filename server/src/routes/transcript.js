// Read a pane's Claude Code jsonl session and return it as normalized chat messages (the "对话" lens's
// read-projection). Pane → cwd (tmux) → the session file under ~/.claude/projects/<encoded-cwd>/. Uses the
// same content-hash `since`省流 as /history: an unchanged transcript returns 204. Mounted under /api.
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
    try {
      const cwd = await commands.paneCurrentPath(req.query.pane);
      const dir = projectsDir();
      const resolved = await resolveEncodedDirSession(dir, cwd);
      if (!resolved.sessionId) return res.json({ messages: [], hash: '', session: null });
      const file = path.join(dir, encodeProjectDir(cwd), resolved.sessionId + '.jsonl');
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch { return res.json({ messages: [], hash: '', session: resolved.sessionId }); }
      const hash = createHash('sha1').update(text).digest('hex').slice(0, 16);
      if (req.query.since === hash) return res.status(204).end();
      res.json({ messages: parseTranscript(text.split('\n')), hash, session: resolved.sessionId });
    } catch (e) { next(e); }
  });
  return r;
}

// git viewer (read-only). Each route calls the git data layer and maps its {error,status} to an HTTP
// status (same shape as the docs routes); the layer enforces the under-$HOME containment and validation.
import express from 'express';

export function gitRoutes({ git }) {
  const r = express.Router();
  const q = (v) => (typeof v === 'string' ? v : '');

  r.get('/git/repos', async (req, res, next) => {
    try {
      const out = await git.detectRepos(q(req.query.dir));
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json({ repos: out.repos });
    } catch (e) { next(e); }
  });
  r.get('/git/status', async (req, res, next) => {
    try {
      const out = await git.status(q(req.query.repo));
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json({ changes: out.changes });
    } catch (e) { next(e); }
  });
  r.get('/git/log', async (req, res, next) => {
    try {
      const out = await git.log(q(req.query.repo), req.query.limit, req.query.ref ? q(req.query.ref) : undefined);
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json({ commits: out.commits });
    } catch (e) { next(e); }
  });
  r.get('/git/branches', async (req, res, next) => {
    try {
      const out = await git.branches(q(req.query.repo));
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json({ branches: out.branches });
    } catch (e) { next(e); }
  });
  r.get('/git/diff', async (req, res, next) => {
    try {
      const out = await git.diff(q(req.query.repo), {
        path: q(req.query.path),
        commit: req.query.commit ? q(req.query.commit) : undefined,
        staged: req.query.staged === '1',
      });
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json({ diff: out.diff, truncated: out.truncated });
    } catch (e) { next(e); }
  });
  r.get('/git/commit', async (req, res, next) => {
    try {
      const out = await git.commit(q(req.query.repo), q(req.query.hash));
      if (out.error) return res.status(out.status).json({ error: out.error });
      res.json({ message: out.message, files: out.files });
    } catch (e) { next(e); }
  });

  return r;
}

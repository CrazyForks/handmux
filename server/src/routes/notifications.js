// Read/delete for the manual-push inbox. Recording happens in routes/push.js (send-local). This
// module is single-purpose: list history (newest first) and delete one entry by id.
import express from 'express';

export function notificationRoutes({ notifications }) {
  const r = express.Router();

  r.get('/notifications', (req, res) => {
    const device = req.query.device;
    res.json({ items: typeof device === 'string' && device ? notifications.list(device) : [] });
  });

  r.delete('/notifications/:id', (req, res) => {
    const device = req.query.device;
    res.json({ ok: typeof device === 'string' && device ? notifications.remove(device, req.params.id) : false });
  });

  return r;
}

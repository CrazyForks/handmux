#!/usr/bin/env node
// handmux statusLine capturer. Claude Code pipes a JSON blob to its `statusLine` command on stdin — the
// ONLY officially-documented local source of the 5-hour / weekly rate-limit percentages (the same numbers
// `/usage` shows). See https://code.claude.com/docs/en/statusline ("Available data": rate_limits.five_hour
// / seven_day, context_window, model). We snapshot those fields to a file the handmux server serves to the
// phone's Usage page, then produce stdout so the terminal statusline still works:
//
//   node handmux-statusline.cjs <usageFile>                        # snapshot + print a compact status line
//   HANDMUX_STATUS_TEE=1 node handmux-statusline.cjs <usageFile>   # snapshot + re-emit stdin verbatim
//
// TEE mode is for a user who ALREADY has a statusline: they pipe `... | handmux-statusline.cjs <f> | their
// renderer`, so their renderer downstream receives the exact same JSON and their display is unchanged.
//
// .cjs so it runs standalone via `node <file>` regardless of any surrounding package.json "type". Best-
// effort and silent throughout — a statusLine command must never fail Claude.
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2];
const raw = (() => { try { return fs.readFileSync(0, 'utf8'); } catch { return ''; } })();
let j = {};
try { j = JSON.parse(raw || '{}'); } catch { /* not JSON → leave j = {} */ }

// One rate-limit window → our shape, or undefined if the field is absent (rate_limits only appears for
// Pro/Max plans, and only after a session's first API response).
function win(o) {
  if (!o || typeof o.used_percentage !== 'number') return undefined;
  const w = { usedPercent: o.used_percentage };
  if (typeof o.resets_at === 'number') w.resetsAt = o.resets_at;
  return w;
}

if (file) {
  try {
    const rl = j.rate_limits || {};
    const cw = j.context_window || {};
    const rateLimits = {
      fiveHour: win(rl.five_hour),
      sevenDay: win(rl.seven_day),
      sevenDayOpus: win(rl.seven_day_opus),
      sevenDaySonnet: win(rl.seven_day_sonnet),
    };
    for (const k of Object.keys(rateLimits)) if (rateLimits[k] === undefined) delete rateLimits[k];
    const snap = {
      updatedAt: Date.now(),
      model: (j.model && (j.model.display_name || j.model.id)) || null,
      context: (typeof cw.used_percentage === 'number') ? { usedPercent: cw.used_percentage } : undefined,
      rateLimits,
    };
    if (snap.context === undefined) delete snap.context;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(snap));
    fs.renameSync(tmp, file); // atomic: concurrent statuslines (multiple sessions) can't tear the snapshot

    // Per-session context snapshot. The global file above is last-writer-wins across ALL sessions, so it
    // can't tell the phone which session a given pane is on. Claude's statusLine stdin carries `session_id`,
    // so we ALSO write a per-session file keyed by it — the server joins pane→session (hook state) → this
    // file to show the CURRENT pane's context-window %. Its own file per session ⇒ no cross-session race.
    const sid = typeof j.session_id === 'string' ? j.session_id : null;
    if (sid && /^[\w-]+$/.test(sid) && snap.context) {
      const cdir = path.join(path.dirname(file), 'context');
      fs.mkdirSync(cdir, { recursive: true });
      const cfile = path.join(cdir, `${sid}.json`);
      const csnap = { sessionId: sid, model: snap.model, usedPercent: snap.context.usedPercent, updatedAt: snap.updatedAt };
      const ctmp = `${cfile}.${process.pid}.tmp`;
      fs.writeFileSync(ctmp, JSON.stringify(csnap));
      fs.renameSync(ctmp, cfile);
      // Best-effort prune of stale session files (ended sessions never clean up after themselves) so the
      // dir can't grow without bound. A day is well past any live session's last statusLine render.
      try {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        for (const nm of fs.readdirSync(cdir)) {
          if (!nm.endsWith('.json')) continue;
          const fp = path.join(cdir, nm);
          try { if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp); } catch { /* skip */ }
        }
      } catch { /* prune is best-effort */ }
    }
  } catch { /* best effort — never fail the statusline */ }
}

// Output. TEE → re-emit stdin so a downstream renderer is unaffected. Otherwise render a compact line from
// whatever fields are present (a plain default statusline for users who had none).
if (process.env.HANDMUX_STATUS_TEE === '1') {
  process.stdout.write(raw);
} else {
  try {
    const seg = [];
    const dir = j.workspace && j.workspace.current_dir;
    if (dir) seg.push(path.basename(dir));
    if (j.model && j.model.display_name) seg.push(j.model.display_name);
    const cw = j.context_window || {};
    if (typeof cw.used_percentage === 'number') seg.push(`Ctx ${Math.round(cw.used_percentage)}%`);
    const rl = j.rate_limits || {};
    if (rl.five_hour && typeof rl.five_hour.used_percentage === 'number') seg.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`);
    if (rl.seven_day && typeof rl.seven_day.used_percentage === 'number') seg.push(`Wk ${Math.round(rl.seven_day.used_percentage)}%`);
    if (seg.length) process.stdout.write(seg.join(' · '));
  } catch { /* silent */ }
}

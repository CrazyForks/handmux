// Pure helpers for the in-app inbox: turn the server's pane-state map (GET /api/states) into the
// roster of all Claude panes, collapse the four raw kinds into three display "views", and apply the
// done-history high-water mark. No I/O — unit-tested.
import { t } from './i18n';

// Raw server kind → display view. idle is just an aged done; permission is the "needs you" bucket
// (covers tool-permission, AskUserQuestion, ExitPlanMode — all fire permission_prompt).
// compacting (context compaction) is a busy state → reads as 进行中. `error` (a turn that died on an API
// error) is deliberately absent: it stays out of the inbox roster and fires no push — surfaced only in the
// chat lens for now, until the StopFailure payload is verified against a real error.
const VIEW = { working: 'working', compacting: 'working', done: 'done', idle: 'done', permission: 'needs' };
// Urgency for ordering within a session AND for the topbar dot's colour: needs > done > working.
const VIEW_RANK = { needs: 3, done: 2, working: 1 };

export const VIEW_LABEL = {
  working: t('inbox.view.working'),
  done: t('inbox.view.done'),
  needs: t('inbox.view.needs'),
};

// One row per Claude pane, grouped-sortable. `done` rows are HISTORY-FILTERED: a done shows only when
// its ts beats both the device high-water mark (readTs) and the per-pane seen ts. working/needs are
// current state and never filtered. Sort: session asc, then needs>working>done, then most-recent.
export function inboxRows(states, seen = {}, readTs = 0) {
  const rows = [];
  for (const [pane, st] of Object.entries(states)) {
    const view = VIEW[st.kind];
    if (!view) continue;
    const ts = st.ts || 0;
    if (view === 'done' && !(ts > Math.max(readTs || 0, seen[pane] || 0))) continue;
    rows.push({ pane, session: st.session, window: st.window, windowName: st.windowName, view, msg: st.msg || '', ts, agent: st.agent || 'claude' });
  }
  rows.sort((a, b) => (
    a.session < b.session ? -1
      : a.session > b.session ? 1
        : (VIEW_RANK[b.view] - VIEW_RANK[a.view]) || (b.ts - a.ts)
  ));
  return rows;
}

// Count rows per display view for the inbox header summary (进行中 / 已完成 / 需要你). Takes the
// already-filtered rows, so 已完成 matches the dones actually shown (history-suppressed ones aren't
// counted) — the header numbers line up exactly with the list below.
export function viewCounts(rows) {
  const c = { working: 0, done: 0, needs: 0 };
  for (const r of rows) if (c[r.view] != null) c[r.view] += 1;
  return c;
}

// Topbar dot colour = the single highest-priority view present in the roster (needs > done > working),
// or null when empty. Takes the already-filtered rows so a history-suppressed done never lights green.
export function topView(rows) {
  let best = null;
  let rank = 0;
  for (const r of rows) {
    const k = VIEW_RANK[r.view] || 0;
    if (k > rank) { rank = k; best = r.view; }
  }
  return best;
}

// Largest ts across all panes — seeds / advances the read-ts high-water mark (server-clock based).
export function maxTs(states) {
  let m = 0;
  for (const st of Object.values(states)) if ((st.ts || 0) > m) m = st.ts;
  return m;
}

// Humanise a ms-epoch timestamp as a short "x 秒/分钟/小时/天前" relative to now (ms-epoch).
export function relTime(ts, now) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return t('time.secAgo', { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t('time.minAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hourAgo', { n: h });
  return t('time.dayAgo', { n: Math.round(h / 24) });
}

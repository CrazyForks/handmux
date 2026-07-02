import { useState } from 'react';
import { InboxIcon } from './icons.jsx';
import { VIEW_LABEL, relTime, viewCounts } from '../inbox.js';
import { t } from '../i18n';

// Top-bar inbox: tray icon + a single priority dot (orange needs > green done > blue working) that
// gives an at-a-glance signal even when nothing "needs you". Opens a dropdown roster of every Claude
// pane (grouped by session) and its current view. Presentational — rows are pre-sorted by inboxRows;
// taps bubble out via the callbacks. 清除已完成 advances the device read-ts high-water mark — it drops
// only the present done rows (working/needs are never history-filtered), so it's shown ONLY when there
// is at least one done row to clear.
export default function Inbox({ rows, top, open, onToggle, onClose, onSelectRow, onMarkAllRead, hooksStatus, onEnableHooks, orphans = [], onTakeover }) {
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.session === r.session) last.items.push(r);
    else groups.push({ session: r.session, items: [r] });
  }
  const now = Date.now();
  const hasDone = rows.some((r) => r.view === 'done');
  const counts = viewCounts(rows);

  const [enabling, setEnabling] = useState(false);
  const [enableErr, setEnableErr] = useState(false);
  const showEnable = groups.length === 0 && hooksStatus === 'absent';
  const doEnable = async () => {
    setEnabling(true); setEnableErr(false);
    try { const r = await onEnableHooks?.(); if (!r || r.status !== 'installed') setEnableErr(true); }
    catch { setEnableErr(true); }
    finally { setEnabling(false); }
  };

  // Orphan Claude sessions (running outside tmux). Pinned to the bottom of the panel, collapsed by
  // default so they don't crowd the main roster. Takeover is destructive (SIGTERMs the original — a
  // resumed session shares the same jsonl with no lock, so two writers corrupt history), so it's a
  // two-tap confirm; the snippet in the row is the "which session is this" safety check.
  const [orphOpen, setOrphOpen] = useState(false);
  const [confirmId, setConfirmId] = useState(null);
  const [takingId, setTakingId] = useState(null);
  const [errId, setErrId] = useState(null);
  const doTakeover = async (o) => {
    setTakingId(o.pid); setErrId(null);
    try { await onTakeover?.(o); } // on success App closes the inbox + navigates into the new pane
    catch { setErrId(o.pid); setTakingId(null); }
  };

  return (
    <>
      <button className="topbar-icon inbox-btn" onClick={onToggle} aria-label={t('inbox.title')} title={t('inbox.title')}>
        <InboxIcon />
        {top && <span className={`inbox-dot ${top}`} aria-hidden="true" />}
      </button>
      {open && (
        <>
          <div className="inbox-backdrop" onClick={onClose} />
          <div className="inbox-panel" role="dialog" aria-label={t('inbox.title')}>
            <div className="inbox-head">
              <span>{t('inbox.title')}</span>
              {/* 进行中/已完成/需要你 tally, top-right of the panel, in line with the 收件箱 title. */}
              <div className="inbox-summary">
                <span className="inbox-chip working">{t('inbox.working')} {counts.working}</span>
                <span className="inbox-chip done">{t('inbox.done')} {counts.done}</span>
                <span className="inbox-chip needs">{t('inbox.needs')} {counts.needs}</span>
              </div>
              {hasDone && <button className="inbox-readall" onClick={onMarkAllRead}>{t('inbox.clearDone')}</button>}
            </div>
            {groups.length === 0 ? (
              showEnable ? (
                <div className="inbox-empty inbox-enable">
                  <div className="inbox-enable-title">{t('inbox.enableTitle')}</div>
                  <div className="inbox-enable-hint">{t('inbox.enableHint')}</div>
                  <button className="inbox-enable-btn" onClick={doEnable} disabled={enabling}>
                    {enabling ? t('inbox.enabling') : t('inbox.enableBtn')}
                  </button>
                  {enableErr && <div className="inbox-enable-err">{t('inbox.enableFailed')}</div>}
                </div>
              ) : (
                orphans.length === 0 && <div className="inbox-empty">{t('inbox.empty')}</div>
              )
            ) : groups.map((g) => (
              <div key={g.session} className="inbox-group">
                <div className="inbox-group-title">{g.session}</div>
                {g.items.map((r) => (
                  <button key={r.pane} className="inbox-row" onClick={() => onSelectRow(r)}>
                    <div className="inbox-row-head">
                      <span className={`inbox-chip ${r.view}`}>{VIEW_LABEL[r.view]}</span>
                      <span className="inbox-loc">{r.windowName || r.window}</span>
                      <span className="inbox-time">{relTime(r.ts, now)}</span>
                    </div>
                    {r.msg && <div className="inbox-msg">{r.msg}</div>}
                  </button>
                ))}
              </div>
            ))}

            {orphans.length > 0 && (
              <div className="inbox-orphans">
                <button className="inbox-orphans-head" onClick={() => setOrphOpen((o) => !o)}>
                  <span>{t('inbox.orphans.title', { n: orphans.length })}</span>
                  <span className="inbox-orphans-caret" aria-hidden="true">{orphOpen ? '▾' : '▸'}</span>
                </button>
                {orphOpen && (
                  <div className="inbox-orphans-body">
                    <div className="inbox-orphans-hint">{t('inbox.orphans.hint')}</div>
                    {orphans.map((o) => {
                      const noSession = !o.sessionId;
                      const disabled = o.state === 'busy' || noSession;
                      const busy = takingId === o.pid;
                      return (
                        <div key={o.pid} className="inbox-orphan-row">
                          <div className="inbox-row-head">
                            <span className={`inbox-chip ${o.state === 'busy' ? 'working' : 'done'}`}>
                              {o.state === 'busy' ? t('inbox.orphans.busy') : t('inbox.orphans.idle')}
                            </span>
                            <span className="inbox-loc">{o.cwdLabel || o.cwd}</span>
                            <span className="inbox-time">{relTime(o.startedAt || o.lastActivity, now)}</span>
                          </div>
                          {o.snippet && <div className="inbox-msg">{o.snippet}</div>}
                          {confirmId === o.pid ? (
                            <div className="inbox-orphan-confirm">
                              <button className="inbox-orphan-kill" disabled={busy} onClick={() => doTakeover(o)}>
                                {busy ? t('inbox.orphans.working') : t('inbox.orphans.confirmKill')}
                              </button>
                              <button className="inbox-orphan-cancel" disabled={busy} onClick={() => setConfirmId(null)}>
                                {t('inbox.orphans.cancel')}
                              </button>
                            </div>
                          ) : (
                            <button
                              className="inbox-orphan-btn"
                              disabled={disabled}
                              onClick={() => { setErrId(null); setConfirmId(o.pid); }}
                            >
                              {noSession ? t('inbox.orphans.noSession') : t('inbox.orphans.takeover')}
                            </button>
                          )}
                          {errId === o.pid && <div className="inbox-enable-err">{t('inbox.orphans.failed')}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

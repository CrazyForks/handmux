import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { recoveryReasonKey } from '../workspaceRecovery.js';
import { formatCheckpointTime } from './WorkspaceRecoveryCard.jsx';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'interrupted']);
const SAFE_ERROR_CODES = new Set([
  'restore-interrupted', 'checkpoint-not-found', 'storage-full', 'permission-denied',
  'plan-failed', 'agent-unavailable', 'tmux-unavailable', 'restore-failed',
]);

function errorCopy(code) {
  return t(`workspace.error.${SAFE_ERROR_CODES.has(code) ? code : 'restore-failed'}`);
}

export default function WorkspaceRestoreDialog({
  open, plan, operation = null, submitting = false, onRestore, onIgnore, onClose,
}) {
  const submitted = useRef(false);
  const busy = submitting || operation?.status === 'pending' || operation?.status === 'running';
  const terminal = operation && TERMINAL.has(operation.status);
  useEffect(() => {
    if (!busy || terminal) submitted.current = false;
  }, [busy, terminal, plan?.checkpointId]);
  if (!open || !plan) return null;

  const restoreCount = (plan.planSummary?.create || 0) + (plan.planSummary?.renamed || 0);
  const alreadyCount = plan.planSummary?.alreadyPresent || 0;
  const renamed = (plan.sessions || []).filter((row) => row.action === 'create-renamed');
  const progress = operation?.progress || { completed: 0, total: restoreCount };
  const failures = (operation?.results || []).filter((row) => row.status === 'failed');
  const restore = () => {
    if (busy || submitted.current) return;
    submitted.current = true;
    onRestore?.();
  };

  return (
    <>
      <div className="settings-backdrop workspace-restore-backdrop" onClick={onClose} />
      <div className="settings-card workspace-restore-dialog" role="dialog" aria-modal="true"
        aria-labelledby="workspace-restore-title">
        <div className="settings-head">
          <span id="workspace-restore-title" className="settings-title">{t('workspace.restoreLast')}</span>
          <button type="button" className="settings-close workspace-restore-close" onClick={onClose}
            aria-label={t('common.close')}>✕</button>
        </div>
        <div className="workspace-restore-body">
          <div className="workspace-restore-reason">{t(recoveryReasonKey(plan))}</div>
          <div className="workspace-restore-time">
            {t('workspace.savedAt', { time: formatCheckpointTime(plan.capturedAt) })}
          </div>
          <div className="workspace-restore-summary">
            {t('workspace.topologySummary', {
              sessions: plan.summary?.sessions ?? 0,
              windows: plan.summary?.windows ?? 0,
              panes: plan.summary?.panes ?? 0,
            })}
          </div>
          <div className="workspace-restore-plan">
            {t('workspace.planSummary', { restore: restoreCount, already: alreadyCount })}
          </div>
          <div className="workspace-restore-note">{t('workspace.renameRule')}</div>
          {renamed.length > 0 && (
            <ul className="workspace-restore-renames">
              {renamed.map((row) => <li key={row.logicalId || row.sourceName}>{row.sourceName} → {row.targetName}</li>)}
            </ul>
          )}
          <div className="workspace-restore-note">{t('workspace.nonDestructive')}</div>

          {operation?.status === 'partial' && (
            <div className="workspace-restore-progress partial" role="status">
              {t('workspace.progressDone', { completed: progress.completed || 0, total: progress.total || restoreCount })}
            </div>
          )}
          {operation?.status === 'succeeded' && <div className="workspace-restore-success">{t('workspace.complete')}</div>}
          {(operation?.status === 'failed' || operation?.status === 'interrupted') && failures.length === 0 && (
            <div className="workspace-restore-errors" role="alert">{errorCopy(operation.errorCode)}</div>
          )}
          {failures.length > 0 && (
            <ul className="workspace-restore-errors" role="alert">
              {failures.map((row, index) => (
                <li key={row.logicalId || `${row.sourceName}-${index}`}>
                  {t('workspace.sessionFailure', {
                    session: row.sourceName || t('workspace.unknownSession'),
                    reason: errorCopy(row.errorCode),
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="workspace-restore-actions">
          <button type="button" className="workspace-restore-primary" disabled={busy} onClick={restore}>
            {busy
              ? t('workspace.progress', { completed: progress.completed || 0, total: progress.total || restoreCount })
              : t('workspace.restore')}
          </button>
          <button type="button" className="workspace-restore-ignore" disabled={busy} onClick={onIgnore}>
            {t('workspace.ignore')}
          </button>
        </div>
      </div>
    </>
  );
}

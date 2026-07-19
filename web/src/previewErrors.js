import { t } from './i18n';

// Turn the API's stable {error} token into a specific, actionable message. Unknown server reasons stay
// visible instead of being collapsed into the misleading "port not listening" fallback.
export function previewStartError(error, { port } = {}) {
  const code = error?.serverError || error?.message || '';
  if (code === 'port not listening') return t('localurl.notListening', { port: port ?? '?' });
  if (code === 'bad port') return t('settings.err_bad_port');
  if (code === 'dynamic disabled' || code === 'previews disabled') return t('localurl.disabled');
  if (code === 'bad protocol') return t('localurl.badProtocol');
  if (error?.name === 'TypeError' || /(?:timeout|failed to fetch|network)/i.test(code)) return t('localurl.network');
  return code ? t('localurl.failed', { reason: code }) : t('settings.err_start_failed');
}

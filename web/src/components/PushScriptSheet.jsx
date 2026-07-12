import { useState } from 'react';
import { t } from '../i18n';

// Self-contained "script push" doc module: three standalone command examples (all devices / a session /
// this device), the two optional flags as a footnote, and — deliberately prominent — the reliability
// boundary. The device example inlines THIS device's real key so it's copy-and-run.
export default function PushScriptSheet({ open, pushKey, notifyOn, onClose }) {
  const [copied, setCopied] = useState('');
  if (!open) return null;

  const base = 'handmux push "构建完成" "耗时 3m12s"';
  const hasKey = !!(notifyOn && pushKey);
  const cmdAll = base;
  const cmdSession = `${base} --session ${t('scriptPush.session_placeholder')}`;
  const cmdDevice = `${base} --device ${hasKey ? pushKey : t('scriptPush.device_placeholder')}`;

  const copy = async (text, which) => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(''), 1500); }
    catch { /* clipboard blocked — user can select manually */ }
  };
  const copyLabel = (which) => (copied === which ? t('scriptPush.copied') : t('common.copy'));

  const example = (which, label, cmd, note) => (
    <div className="push-script-block">
      <div className="push-script-label">{label}</div>
      <pre className="push-script-cmd"><code>{cmd}</code></pre>
      {note && <div className="push-script-hint">{note}</div>}
      <button className="fontbtn" onClick={() => copy(cmd, which)}>{copyLabel(which)}</button>
    </div>
  );

  return (
    <>
      <div className="settings-backdrop push-script-backdrop" onClick={onClose} />
      <div className="settings-card push-script-sheet" role="dialog" aria-label={t('scriptPush.title')} aria-modal="true">
        <div className="settings-head">
          <span className="settings-title">{t('scriptPush.title')}</span>
          <button className="settings-close" onClick={onClose} aria-label={t('common.close')}>✕</button>
        </div>

        <p className="push-script-intro">{t('scriptPush.intro')}</p>

        {example('all', t('scriptPush.scope_all'), cmdAll)}
        {example('session', t('scriptPush.scope_session'), cmdSession)}
        {example('device', t('scriptPush.scope_device'), cmdDevice,
          hasKey ? t('scriptPush.device_key_note') : t('scriptPush.device_need_enable'))}

        <div className="push-script-block">
          <div className="push-script-label">{t('scriptPush.opts_label')}</div>
          <ul className="push-script-fields">
            <li>{t('scriptPush.opt_tag')}</li>
            <li>{t('scriptPush.opt_url')}</li>
          </ul>
        </div>

        <div className="push-script-note">{t('scriptPush.reliability')}</div>
      </div>
    </>
  );
}

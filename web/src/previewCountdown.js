// Shared preview-TTL countdown, used by both the preview sheet header and the settings preview row.
import { useEffect, useState } from 'react';
import { t } from './i18n';

// Floor (never round UP) the remaining ms into M:SS. expiresAt is stamped on the server's clock while
// we tick on the device's clock, so a sub-second skew used to push a fresh 1h renew to 60:01 via
// Math.round — floor caps it at 60:00.
export const fmtRemain = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Minutes-only remaining (a ticking M:SS countdown felt too pressuring). ROUND (not ceil): expiresAt
// is stamped on the server clock while we tick on the device clock, so a fresh 1h renew often reads a
// few hundred ms OVER 3,600,000 — ceil turned that into a "61 分钟" flash that snapped back to 60.
// Round absorbs the sub-second skew (60 stays 60) while still reading 60 for a true full hour; the
// max(1) keeps the last partial minute from showing "0 分钟" before it truly elapses.
export const fmtRemainMin = (ms) => {
  if (ms <= 0) return t('time.expired');
  const m = Math.max(1, Math.round(ms / 60000));
  return t('time.minutes', { n: m });
};

// Live remaining-ms for a preview's expiresAt, re-ticking each second while `active`. Returns 0 when
// inactive / no expiry. Re-seeds `now` on (re)activation so a freshly-opened view shows the right value
// immediately rather than one stale second.
export function useRemaining(expiresAt, active = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || expiresAt == null) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, expiresAt]);
  return expiresAt != null ? Math.max(0, expiresAt - now) : 0;
}

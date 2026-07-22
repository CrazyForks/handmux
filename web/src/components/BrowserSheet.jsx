import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  ClockIcon,
  GlobeIcon,
  MonitorIcon,
  PlusIcon,
  RefreshIcon,
  SmartphoneIcon,
  XIcon,
} from './icons.jsx';
import { BROWSER_CLOSE_AFTER_OPTIONS } from '../browserState.js';
import { t } from '../i18n';

// Temporary compatibility validation only: unsafe while proxied pages share the Handmux origin.
const FRAME_SANDBOX = 'allow-scripts allow-forms allow-downloads allow-modals allow-popups allow-same-origin';

function tabLabel(tab) {
  if (tab.title) return tab.title;
  try { return new URL(tab.originalUrl).hostname; } catch { return tab.originalUrl; }
}

export default function BrowserSheet({ browser }) {
  const {
    open, consentOpen, tabs, activeId, historyActive, closeAfter, history, error,
    openUrl, switchTab, closeTab, setOpen, setCloseAfter,
    navigateTab, updateTabMeta, clearHistory, enableAccess, cancelAccess,
  } = browser;
  const active = tabs.find((tab) => tab.id === activeId) || null;
  const [address, setAddress] = useState(active?.originalUrl || '');
  const [timeOpen, setTimeOpen] = useState(false);
  const [device, setDevice] = useState('mobile');
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [loadedTabs, setLoadedTabs] = useState(() => new Set());
  const [refreshingTabs, setRefreshingTabs] = useState(() => new Set());
  const frames = useRef(new Map());
  const frameUrls = useRef(new Map());
  const switchingOrigins = useRef(new Map());
  const addressRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    setAddress(historyActive ? '' : (active?.originalUrl || ''));
  }, [active?.originalUrl, historyActive]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.source !== 'handmux-browser') return;
      const frameEntry = [...frames.current.entries()]
        .find(([, frame]) => frame.contentWindow === event.source);
      const tab = frameEntry && tabs.find((item) => item.id === frameEntry[0]);
      if (!tab || tab.channel !== event.data.channel) return;
      if (event.data.type === 'navigate') {
        setRefreshingTabs((current) => new Set(current).add(tab.id));
      }
      const originOf = (raw) => { try { return new URL(raw).origin; } catch { return null; } };
      const currentOrigin = originOf(tab.originalUrl);
      const nextOrigin = originOf(event.data.url);
      if ((event.data.type === 'navigate' || event.data.type === 'load')
        && currentOrigin && nextOrigin && currentOrigin !== nextOrigin) {
        if (switchingOrigins.current.get(tab.id) !== nextOrigin) {
          switchingOrigins.current.set(tab.id, nextOrigin);
          let switching;
          try { switching = navigateTab(tab.id, event.data.url); }
          catch {
            switchingOrigins.current.delete(tab.id);
            return;
          }
          Promise.resolve(switching).then((result) => {
            if (!result && switchingOrigins.current.get(tab.id) === nextOrigin) {
              switchingOrigins.current.delete(tab.id);
            }
          }, () => {
            if (switchingOrigins.current.get(tab.id) === nextOrigin) switchingOrigins.current.delete(tab.id);
          });
        }
        return;
      }
      updateTabMeta(tab.id, { url: event.data.url, title: event.data.title });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [navigateTab, tabs, updateTabMeta]);

  useEffect(() => {
    setLoadedTabs((current) => {
      const next = new Set();
      for (const tab of tabs) {
        if (current.has(tab.id) && frameUrls.current.get(tab.id) === tab.url) next.add(tab.id);
      }
      frameUrls.current = new Map(tabs.map((tab) => [tab.id, tab.url]));
      return next;
    });
  }, [tabs]);

  useEffect(() => {
    for (const [id, origin] of switchingOrigins.current) {
      const tab = tabs.find((item) => item.id === id);
      let currentOrigin = null;
      try { currentOrigin = new URL(tab?.originalUrl).origin; } catch { /* removed tab */ }
      if (!tab || currentOrigin === origin) switchingOrigins.current.delete(id);
    }
  }, [tabs]);

  useEffect(() => {
    if (!open || !bodyRef.current) return undefined;
    const measure = () => setBodySize({
      width: bodyRef.current.clientWidth,
      height: bodyRef.current.clientHeight,
    });
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(bodyRef.current);
    return () => observer.disconnect();
  }, [open]);

  const postCommand = (command) => {
    if (!active) return;
    frames.current.get(active.id)?.contentWindow?.postMessage({
      source: 'handmux-browser-parent',
      channel: active.channel,
      command,
    }, '*');
  };

  const refreshActive = () => {
    if (!active) return;
    setRefreshingTabs((current) => new Set(current).add(active.id));
    postCommand('reload');
  };

  const frameLoaded = (tab) => {
    frameUrls.current.set(tab.id, tab.url);
    setLoadedTabs((current) => new Set(current).add(tab.id));
    setRefreshingTabs((current) => {
      const next = new Set(current);
      next.delete(tab.id);
      return next;
    });
  };

  const submitAddress = (event) => {
    event.preventDefault();
    if (historyActive || !active) openUrl(address);
    else navigateTab(active.id, address);
  };

  const newTab = () => {
    switchTab('history');
    setAddress('');
    requestAnimationFrame(() => addressRef.current?.focus());
  };

  const pickTime = (value) => {
    setCloseAfter(value);
    setTimeOpen(false);
  };
  const desktopScale = device === 'desktop' && bodySize.width > 0 ? bodySize.width / 1280 : 1;
  const scalerStyle = device === 'desktop' && bodySize.height > 0
    ? { width: `${1280 * desktopScale}px`, height: `${bodySize.height}px` }
    : undefined;
  const frameStyle = device === 'desktop' && bodySize.height > 0
    ? { width: '1280px', height: `${bodySize.height / desktopScale}px`, transform: `scale(${desktopScale})`, transformOrigin: '0 0' }
    : undefined;

  if (consentOpen) return createPortal(
    <div className="file-sheet browser-sheet open browser-consent" role="dialog" aria-modal="true" aria-label={t('browser.consentTitle')}>
      <div className="browser-consent-card">
        <GlobeIcon />
        <h2>{t('browser.consentTitle')}</h2>
        <p>{t('browser.consentBody')}</p>
        <ul>
          <li>{t('browser.consentComputer')}</li>
          <li>{t('browser.consentPrivate')}</li>
          <li>{t('browser.consentIdle')}</li>
        </ul>
        <div className="browser-consent-actions">
          <button onClick={cancelAccess}>{t('common.cancel')}</button>
          <button className="browser-consent-enable" onClick={enableAccess}>{t('browser.enable')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );

  return createPortal(
    <div className={`file-sheet browser-sheet ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="browser-tabs" role="tablist" aria-label={t('browser.openTabs')}>
        <button className={`browser-tab browser-history-tab ${historyActive ? 'active' : ''}`} role="tab"
          aria-selected={historyActive} onClick={() => switchTab('history')}>
          <ClockIcon />{t('browser.history')}
        </button>
        <div className="browser-tabs-scroll">
          {tabs.map((tab) => {
            const selected = !historyActive && tab.id === activeId;
            const label = tabLabel(tab);
            return (
              <span className={`browser-tab-wrap ${selected ? 'active' : ''}`} key={tab.id}>
                <button className="browser-tab" role="tab" aria-selected={selected} title={tab.originalUrl}
                  onClick={() => switchTab(tab.id)}>{label}</button>
                <button className="browser-tab-close" aria-label={t('browser.closeTab', { title: label })}
                  onClick={() => closeTab(tab.id)}><XIcon /></button>
              </span>
            );
          })}
        </div>
        <button className="browser-head-button" aria-label={t('browser.newTab')} title={t('browser.newTab')} onClick={newTab}><PlusIcon /></button>
        <button className="browser-head-button" aria-label={t('browser.minimize')} title={t('browser.minimize')} onClick={() => setOpen(false)}><ChevronDownIcon /></button>
      </div>

      <div className="browser-nav">
        <button className="browser-nav-button" aria-label={t('browser.back')} disabled={!active || historyActive} onClick={() => postCommand('back')}>‹</button>
        <button className="browser-nav-button" aria-label={t('browser.forward')} disabled={!active || historyActive} onClick={() => postCommand('forward')}>›</button>
        <form className="browser-address-form" onSubmit={submitAddress}>
          <GlobeIcon />
          <input ref={addressRef} className="browser-address" aria-label={t('browser.address')}
            value={address} onChange={(event) => setAddress(event.target.value)}
            placeholder={t('browser.addressPlaceholder')} autoCapitalize="none" autoCorrect="off" spellCheck="false" />
        </form>
        <button className={`browser-nav-button browser-refresh ${active && refreshingTabs.has(active.id) ? 'loading' : ''}`}
          aria-label={t('browser.refresh')} aria-busy={active ? refreshingTabs.has(active.id) : false}
          disabled={!active || historyActive} onClick={refreshActive}><RefreshIcon /></button>
        <button className="browser-nav-button" aria-label={t('browser.viewMode')}
          title={device === 'mobile' ? t('browser.desktopView') : t('browser.mobileView')}
          aria-pressed={device === 'desktop'} onClick={() => setDevice((value) => (value === 'mobile' ? 'desktop' : 'mobile'))}>
          {device === 'mobile' ? <MonitorIcon /> : <SmartphoneIcon />}
        </button>
        <button className="browser-nav-button" aria-label={t('browser.closeTiming')} aria-expanded={timeOpen}
          onClick={() => setTimeOpen((value) => !value)}><ClockIcon /></button>
        {timeOpen && (
          <div className="browser-time-menu" role="dialog" aria-label={t('browser.closeTiming')}>
            {BROWSER_CLOSE_AFTER_OPTIONS.map((value) => (
              <button key={value ?? 'never'} className="browser-time-option" aria-pressed={closeAfter === value}
                onClick={() => pickTime(value)}>
                {value == null ? t('browser.neverClose') : t('browser.minutes', { value })}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={bodyRef} className={`browser-content ${device === 'desktop' ? 'desktop' : ''}`}>
        <section className="browser-history" hidden={!historyActive}>
          <div className="browser-history-head">
            <h2>{t('browser.history')}</h2>
            {history.length > 0 && <button onClick={clearHistory}>{t('browser.clearHistory')}</button>}
          </div>
          {history.length === 0 ? <p className="browser-empty">{t('browser.emptyHistory')}</p> : (
            <div className="browser-history-list">
              {history.map((entry, index) => (
                <button key={`${entry.visitedAt}-${entry.url}-${index}`} onClick={() => openUrl(entry.url)}>
                  <strong>{entry.title || entry.url}</strong>
                  <span>{entry.url}</span>
                </button>
              ))}
            </div>
          )}
        </section>
        {tabs.map((tab) => {
          const selected = !historyActive && tab.id === activeId;
          const loading = selected && (!loadedTabs.has(tab.id) || frameUrls.current.get(tab.id) !== tab.url || refreshingTabs.has(tab.id));
          return (
          <div key={tab.id} className="browser-pane" hidden={!selected}>
            <div className="browser-frame-scaler" style={scalerStyle}>
              <iframe
                ref={(node) => { if (node) frames.current.set(tab.id, node); else frames.current.delete(tab.id); }}
                data-tab-id={tab.id}
                className="browser-frame"
                title={tabLabel(tab)}
                src={tab.url}
                sandbox={FRAME_SANDBOX}
                style={frameStyle}
                onLoad={() => frameLoaded(tab)}
              />
              {loading && <div className="browser-page-loading" role="status"><span className="spinner" aria-hidden="true" />{t('common.loading')}</div>}
            </div>
          </div>
          );
        })}
        {error && (
          <div className="browser-error" role="alert">
            <span>{error.message || t('browser.loadFailed')}</span>
            {active && <button onClick={() => navigateTab(active.id, active.originalUrl)}>{t('browser.retry')}</button>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

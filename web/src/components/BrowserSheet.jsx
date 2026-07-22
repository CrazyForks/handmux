import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  ClockIcon,
  GlobeIcon,
  MonitorIcon,
  PlusIcon,
  RefreshIcon,
  SmartphoneIcon,
  StopIcon,
  XIcon,
} from './icons.jsx';
import { BROWSER_CLOSE_AFTER_OPTIONS, upsertBrowserHistory } from '../browserState.js';
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
    defaultMode, proxyAvailable,
    openUrl, switchTab, closeTab, setOpen, setCloseAfter,
    navigateTab, updateTabMeta, clearHistory, enableAccess, cancelAccess,
  } = browser;
  const active = tabs.find((tab) => tab.id === activeId) || null;
  const proxied = active?.mode === 'proxy';
  const [address, setAddress] = useState(active?.originalUrl || '');
  const [timeOpen, setTimeOpen] = useState(false);
  const [device, setDevice] = useState('mobile');
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [loadedTabs, setLoadedTabs] = useState(() => new Set());
  const [refreshingTabs, setRefreshingTabs] = useState(() => new Set());
  const [reloadIntent, setReloadIntent] = useState(null);
  const [reloadKeys, setReloadKeys] = useState({});
  const [modeOpen, setModeOpen] = useState(false);
  const [historyModeOpen, setHistoryModeOpen] = useState(null);
  const [slowDirectId, setSlowDirectId] = useState(null);
  const frames = useRef(new Map());
  const frameUrls = useRef(new Map());
  const switchingOrigins = useRef(new Map());
  const addressRef = useRef(null);
  const bodyRef = useRef(null);
  const selectionEpoch = useRef(0);

  useEffect(() => {
    setAddress(historyActive ? '' : (active?.originalUrl || ''));
  }, [active?.originalUrl, historyActive]);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.source !== 'handmux-browser') return;
      const frameEntry = [...frames.current.entries()]
        .find(([, frame]) => frame.contentWindow === event.source);
      const tab = frameEntry && tabs.find((item) => item.id === frameEntry[0]);
      if (!tab || tab.mode !== 'proxy' || tab.channel !== event.data.channel) return;
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
      if (['ready', 'load', 'urlchange', 'title'].includes(event.data.type)) {
        updateTabMeta(tab.id, { url: event.data.url, title: event.data.title });
      }
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

  const postTabCommand = useCallback((tab, command) => {
    if (!tab || tab.mode !== 'proxy') return;
    frames.current.get(tab.id)?.contentWindow?.postMessage({
      source: 'handmux-browser-parent',
      channel: tab.channel,
      command,
    }, '*');
  }, []);

  useEffect(() => {
    if (!reloadIntent) return;
    if (reloadIntent.epoch !== selectionEpoch.current) {
      setReloadIntent(null);
      return;
    }
    if (historyActive || activeId !== reloadIntent.id) return;
    const tab = tabs.find((item) => item.id === reloadIntent.id);
    if (!tab) {
      setReloadIntent(null);
      return;
    }
    if (tab.mode === 'proxy') {
      setRefreshingTabs((current) => new Set(current).add(tab.id));
      postTabCommand(tab, 'reload');
    } else {
      setReloadKeys((current) => ({ ...current, [tab.id]: (current[tab.id] || 0) + 1 }));
    }
    setReloadIntent(null);
  }, [activeId, historyActive, postTabCommand, reloadIntent, tabs]);

  const postCommand = (command) => postTabCommand(active, command);

  const selectTab = async (tab) => {
    const epoch = ++selectionEpoch.current;
    const switched = await switchTab(tab.id);
    if (!switched || epoch !== selectionEpoch.current) return;
    setReloadIntent({ id: tab.id, epoch });
  };

  const selectHistory = () => {
    selectionEpoch.current += 1;
    setReloadIntent(null);
    return switchTab('history');
  };

  const refreshActive = () => {
    if (!active) return;
    setRefreshingTabs((current) => new Set(current).add(active.id));
    if (proxied) postCommand('reload');
    else setReloadKeys((current) => ({ ...current, [active.id]: (current[active.id] || 0) + 1 }));
  };

  const stopActive = () => {
    if (!active) return;
    postCommand('stop');
    frameUrls.current.set(active.id, active.url);
    setLoadedTabs((current) => new Set(current).add(active.id));
    setRefreshingTabs((current) => {
      const next = new Set(current);
      next.delete(active.id);
      return next;
    });
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

  const chooseMode = (mode) => {
    if (!active || mode === active.mode || (mode === 'proxy' && !proxyAvailable)) {
      setModeOpen(false);
      return;
    }
    navigateTab(active.id, active.originalUrl, mode);
    setModeOpen(false);
  };

  const openHistory = (entry, mode = entry.lastMode || defaultMode, persistMode = false) => {
    setHistoryModeOpen(null);
    if (persistMode) upsertBrowserHistory({ ...entry, lastMode: mode });
    openUrl(entry.url, { mode });
  };

  const newTab = () => {
    selectHistory();
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
  const activeLoading = !!active && (!loadedTabs.has(active.id)
    || frameUrls.current.get(active.id) !== active.url || refreshingTabs.has(active.id));

  useEffect(() => {
    if (!open || !activeLoading || proxied || !active) {
      setSlowDirectId(null);
      return undefined;
    }
    const timer = setTimeout(() => setSlowDirectId(active.id), 5000);
    return () => clearTimeout(timer);
  }, [active?.id, activeLoading, open, proxied]);

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
          aria-selected={historyActive} onClick={selectHistory}>
          <ClockIcon />{t('browser.history')}
        </button>
        <div className="browser-tabs-scroll">
          {tabs.map((tab) => {
            const selected = !historyActive && tab.id === activeId;
            const label = tabLabel(tab);
            return (
              <span className={`browser-tab-wrap ${tab.mode} ${selected ? 'active' : ''}`} key={tab.id}>
                <button className="browser-tab" role="tab" aria-selected={selected} title={tab.originalUrl}
                  onClick={() => selectTab(tab)}>
                  {tab.mode === 'proxy' && <span className="browser-mode-badge proxy" aria-label={t('browser.proxyMode')} />}
                  <span className="browser-tab-label">{label}</span>
                </button>
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
        {proxied && <button className="browser-nav-button" aria-label={t('browser.back')} disabled={!active || historyActive} onClick={() => postCommand('back')}>‹</button>}
        {proxied && <button className="browser-nav-button" aria-label={t('browser.forward')} disabled={!active || historyActive} onClick={() => postCommand('forward')}>›</button>}
        <form className="browser-address-form" onSubmit={submitAddress}>
          <GlobeIcon />
          {active && <span className={`browser-address-mode ${active.mode}`}>{t(active.mode === 'proxy' ? 'browser.proxyBadge' : 'browser.directBadge')}</span>}
          <input ref={addressRef} className="browser-address" aria-label={t('browser.address')}
            value={address} onChange={(event) => setAddress(event.target.value)}
            placeholder={t('browser.addressPlaceholder')} autoCapitalize="none" autoCorrect="off" spellCheck="false" />
        </form>
        <button className={`browser-nav-button browser-refresh ${activeLoading ? 'loading' : ''}`}
          aria-label={t(activeLoading && proxied ? 'browser.stop' : 'browser.refresh')} aria-busy={activeLoading}
          disabled={!active || historyActive} onClick={activeLoading && proxied ? stopActive : refreshActive}>
          {activeLoading && proxied ? <StopIcon /> : <RefreshIcon />}
        </button>
        <button className={`browser-nav-button browser-mode-switch ${proxied ? 'proxy' : ''}`}
          aria-label={t('browser.switchMode')} aria-expanded={modeOpen} disabled={!active || historyActive}
          onClick={() => setModeOpen((value) => !value)}>{proxied ? '●' : '○'}</button>
        {modeOpen && active && (
          <div className="browser-mode-menu" role="dialog" aria-label={t('browser.switchMode')}>
            <button className="browser-mode-option" aria-pressed={active.mode === 'direct'} onClick={() => chooseMode('direct')}>{t('browser.directMode')}</button>
            <button className="browser-mode-option proxy" aria-pressed={active.mode === 'proxy'} disabled={!proxyAvailable}
              onClick={() => chooseMode('proxy')}>{t('browser.proxyMode')}</button>
            {!proxyAvailable && <p>{t('browser.proxyUnavailable')}</p>}
          </div>
        )}
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
              {history.map((entry, index) => {
                const key = `${entry.visitedAt}-${entry.url}-${index}`;
                return (
                  <div className="browser-history-row" key={key}>
                    <button className="browser-history-main" onClick={() => openHistory(entry)}>
                      <strong>{entry.title || entry.url}</strong>
                      <span>{entry.url}</span>
                    </button>
                    <button className="browser-history-more" aria-label={t('browser.historyMore')}
                      aria-expanded={historyModeOpen === key}
                      onClick={() => setHistoryModeOpen((value) => value === key ? null : key)}>…</button>
                    {historyModeOpen === key && (
                      <div className="browser-history-mode-menu" role="dialog" aria-label={t('browser.openMode')}>
                        <button className="browser-history-mode-option" onClick={() => openHistory(entry, 'direct', true)}>{t('browser.directMode')}</button>
                        <button className="browser-history-mode-option proxy" disabled={!proxyAvailable}
                          onClick={() => openHistory(entry, 'proxy', true)}>{t('browser.proxyMode')}</button>
                        {!proxyAvailable && <p>{t('browser.proxyUnavailable')}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {tabs.map((tab) => {
          const selected = !historyActive && tab.id === activeId;
          const loading = selected && (!loadedTabs.has(tab.id) || frameUrls.current.get(tab.id) !== tab.url || refreshingTabs.has(tab.id));
          return (
          <div key={tab.id} className={`browser-pane ${tab.mode}`} hidden={!selected}>
            <div className="browser-frame-scaler" style={scalerStyle}>
              <iframe key={`${tab.id}-${reloadKeys[tab.id] || 0}`}
                ref={(node) => { if (node) frames.current.set(tab.id, node); else frames.current.delete(tab.id); }}
                data-tab-id={tab.id}
                className="browser-frame"
                title={tabLabel(tab)}
                src={tab.url}
                sandbox={FRAME_SANDBOX}
                inert={loading ? '' : undefined}
                style={frameStyle}
                onLoad={() => frameLoaded(tab)}
              />
              {loading && (
                <div className="browser-page-loading" role="status" aria-live="polite">
                  <div className="browser-page-progress" role="progressbar" aria-label={t('common.loading')} />
                  {tab.mode === 'direct' && proxyAvailable && slowDirectId === tab.id && (
                    <button className="browser-try-proxy" onClick={() => navigateTab(tab.id, tab.originalUrl, 'proxy')}>{t('browser.tryProxy')}</button>
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })}
        {error && (
          <div className="browser-error" role="alert">
            <span>{error.message || t('browser.loadFailed')}</span>
            {active && active.mode === 'direct' && proxyAvailable
              ? <button onClick={() => navigateTab(active.id, active.originalUrl, 'proxy')}>{t('browser.tryProxy')}</button>
              : active && <button onClick={() => navigateTab(active.id, active.originalUrl, active.mode)}>{t('browser.retry')}</button>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

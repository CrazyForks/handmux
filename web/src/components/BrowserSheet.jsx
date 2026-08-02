import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDownIcon,
  GlobeIcon,
  HomeIcon,
  MoreHorizontalIcon,
  MonitorIcon,
  PlusIcon,
  RefreshIcon,
  SmartphoneIcon,
  StopIcon,
  XIcon,
} from './icons.jsx';
import { BROWSER_CLOSE_AFTER_OPTIONS } from '../browserState.js';
import { t } from '../i18n';
import { useModalFocusTrap } from '../hooks/useModalFocusTrap.js';

// Temporary compatibility validation only: unsafe while proxied pages share the Handmux origin.
const FRAME_SANDBOX = 'allow-scripts allow-forms allow-downloads allow-modals allow-popups allow-same-origin';
const ZOOMABLE_VIEWPORT = 'width=device-width, initial-scale=1';

function allowViewportZoom(content) {
  if (!content) return ZOOMABLE_VIEWPORT;
  return content.split(',')
    .map((part) => part.trim())
    .filter((part) => !/^(maximum-scale|user-scalable)\s*=/i.test(part))
    .join(', ');
}

function tabLabel(tab) {
  if (tab.title) return tab.title;
  try { return new URL(tab.originalUrl).hostname; } catch { return tab.originalUrl; }
}

export default function BrowserSheet({ browser }) {
  const {
    open, accessEnabled, consentOpen, tabs, activeId, historyActive, closeAfter, history, error,
    persistProxyLogin, proxyAvailable,
    openUrl, switchTab, closeTab, setOpen, setCloseAfter,
    navigateTab, ensureBinding, recoverBinding, markBindingReady, updateTabMeta,
    clearHistory, setHistoryMode, enableAccess, cancelAccess,
    setProxyLoginPolicy,
    clearProxyLogin, deleteHistory,
  } = browser;
  const active = tabs.find((tab) => tab.id === activeId) || null;
  const proxied = active?.mode === 'proxy';
  const [newPageMode, setNewPageMode] = useState('direct');
  const menuMode = historyActive || !active ? newPageMode : active.mode;
  const [address, setAddress] = useState(active?.originalUrl || '');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [device, setDevice] = useState('mobile');
  const [bodySize, setBodySize] = useState({ width: 0, height: 0 });
  const [loadedTabs, setLoadedTabs] = useState(() => new Set());
  const [refreshingTabs, setRefreshingTabs] = useState(() => new Set());
  const [reloadKeys, setReloadKeys] = useState({});
  const [historyModeOpen, setHistoryModeOpen] = useState(null);
  const [clearConfirmation, setClearConfirmation] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [slowDirectId, setSlowDirectId] = useState(null);
  const [mountedTabs, setMountedTabs] = useState(() => new Set());
  const [unhealthyTabs, setUnhealthyTabs] = useState(() => new Set());
  const frames = useRef(new Map());
  const frameUrls = useRef(new Map());
  const refreshSequences = useRef(new Map());
  const activeIdRef = useRef(activeId);
  const openRef = useRef(open);
  const activeTabRef = useRef(null);
  const addressRef = useRef(null);
  const bodyRef = useRef(null);
  const clearTriggerRef = useRef(null);
  const clearCancelRef = useRef(null);
  const clearDialogRef = useRef(null);
  activeIdRef.current = activeId;
  openRef.current = open;

  useEffect(() => {
    if (!open) return undefined;
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return undefined;
    const previous = viewport.getAttribute('content');
    viewport.setAttribute('content', allowViewportZoom(previous));
    return () => {
      if (previous == null) viewport.removeAttribute('content');
      else viewport.setAttribute('content', previous);
    };
  }, [open]);

  useEffect(() => {
    setAddress(historyActive ? '' : (active?.originalUrl || ''));
  }, [active?.originalUrl, historyActive]);

  useEffect(() => {
    if (!proxyAvailable) setNewPageMode('direct');
  }, [proxyAvailable]);

  useEffect(() => {
    setOptionsOpen(false);
    setTimeOpen(false);
    if (!historyActive) setHistoryModeOpen(null);
  }, [activeId, historyActive, open]);

  useLayoutEffect(() => {
    if (!open || historyActive || !activeId) return;
    activeTabRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeId, historyActive, open, tabs.length]);

  useEffect(() => {
    if (!accessEnabled) {
      setMountedTabs(new Set());
      return;
    }
    if (!open || historyActive || !active) return;
    setMountedTabs((current) => new Set(current).add(active.id));
    if (active.mode === 'proxy' && unhealthyTabs.has(active.id)) {
      setUnhealthyTabs((current) => {
        const next = new Set(current);
        next.delete(active.id);
        return next;
      });
      void recoverBinding(active.id);
    } else if (active.mode === 'proxy' && !active.url) {
      void ensureBinding(active.id);
    }
  }, [
    accessEnabled, active?.id, active?.mode, active?.url, ensureBinding, historyActive,
    open, recoverBinding, unhealthyTabs,
  ]);

  useModalFocusTrap({
    active: !!clearConfirmation,
    dialogRef: clearDialogRef,
    initialFocusRef: clearCancelRef,
    returnFocusRef: clearTriggerRef,
    onClose: () => setClearConfirmation(null),
  });

  useEffect(() => {
    const onMessage = (event) => {
      if (event.data?.source !== 'handmux-browser') return;
      const frameEntry = [...frames.current.entries()]
        .find(([, frame]) => frame.contentWindow === event.source);
      const tab = frameEntry && tabs.find((item) => item.id === frameEntry[0]);
      if (!tab || tab.mode !== 'proxy' || tab.channel !== event.data.channel) return;
      if (event.data.type === 'ready') {
        markBindingReady(tab.id, event.data.channel);
        setUnhealthyTabs((current) => {
          if (!current.has(tab.id)) return current;
          const next = new Set(current);
          next.delete(tab.id);
          return next;
        });
      }
      if (event.data.type === 'navigate') {
        setRefreshingTabs((current) => new Set(current).add(tab.id));
      }
      if (['ready', 'load', 'urlchange', 'title'].includes(event.data.type)) {
        updateTabMeta(tab.id, { url: event.data.url, title: event.data.title });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [markBindingReady, tabs, updateTabMeta]);

  useEffect(() => {
    setLoadedTabs((current) => {
      const next = new Set();
      for (const tab of tabs) {
        if (current.has(tab.id) && frameUrls.current.get(tab.id) === tab.url) next.add(tab.id);
      }
      frameUrls.current = new Map(tabs.map((tab) => [tab.id, tab.url]));
      return next;
    });
    setMountedTabs((current) => {
      const live = new Set(tabs.map((tab) => tab.id));
      for (const id of refreshSequences.current.keys()) {
        if (!live.has(id)) refreshSequences.current.delete(id);
      }
      return new Set([...current].filter((id) => live.has(id)));
    });
    setUnhealthyTabs((current) => {
      const live = new Set(tabs.map((tab) => tab.id));
      return new Set([...current].filter((id) => live.has(id)));
    });
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

  const postCommand = (command) => postTabCommand(active, command);

  const selectTab = (tab) => {
    setOptionsOpen(false);
    setHistoryError(null);
    switchTab(tab.id);
  };

  const selectHistory = () => {
    setOptionsOpen(false);
    setHistoryError(null);
    setNewPageMode('direct');
    return switchTab('history');
  };

  const refreshActive = async () => {
    if (!active) return;
    const tab = active;
    const sequence = (refreshSequences.current.get(tab.id) || 0) + 1;
    refreshSequences.current.set(tab.id, sequence);
    setRefreshingTabs((current) => new Set(current).add(tab.id));
    if (!proxied) {
      setReloadKeys((current) => ({ ...current, [tab.id]: (current[tab.id] || 0) + 1 }));
      return;
    }
    const navigated = await navigateTab(tab.id, tab.originalUrl, tab.mode);
    if (refreshSequences.current.get(tab.id) !== sequence) return;
    if (navigated?.id === tab.id && navigated.mode === 'proxy' && navigated.url) {
      setReloadKeys((current) => ({ ...current, [tab.id]: (current[tab.id] || 0) + 1 }));
      return;
    }
    setRefreshingTabs((current) => {
      const next = new Set(current);
      next.delete(tab.id);
      return next;
    });
  };

  const stopActive = () => {
    if (!active) return;
    refreshSequences.current.set(active.id, (refreshSequences.current.get(active.id) || 0) + 1);
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
    setHistoryError(null);
    if (historyActive || !active) openUrl(address, { mode: newPageMode });
    else navigateTab(active.id, address);
  };

  const chooseMode = (mode) => {
    if (mode === menuMode || (mode === 'proxy' && !proxyAvailable)) return;
    setHistoryError(null);
    if (historyActive || !active) {
      setNewPageMode(mode);
      return;
    }
    navigateTab(active.id, active.originalUrl, mode);
  };

  const openHistory = (entry, mode = entry.lastMode || 'direct', persistMode = false) => {
    setHistoryModeOpen(null);
    if (mode === 'proxy' && !proxyAvailable) {
      setHistoryError(t('browser.proxyUnavailable'));
      return;
    }
    setHistoryError(null);
    if (persistMode) setHistoryMode(entry, mode);
    openUrl(entry.url, { mode });
  };

  const requestActiveSiteClear = () => {
    let origin;
    try { origin = new URL(active.originalUrl).origin; } catch { return; }
    clearTriggerRef.current = document.activeElement;
    setClearConfirmation({ type: 'site', origin });
  };

  const confirmSiteClear = () => {
    const pending = clearConfirmation;
    setClearConfirmation(null);
    if (pending?.type === 'site') clearProxyLogin(pending.origin);
    if (pending?.type === 'all') clearProxyLogin(null);
  };

  const removeHistory = (entry) => {
    setHistoryModeOpen(null);
    deleteHistory(entry);
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
          <li>{t('browser.consentLimits')}</li>
          <li>{t('browser.consentIdle')}</li>
        </ul>
        <div className="browser-consent-actions">
          <button onClick={cancelAccess}>{t('common.cancel')}</button>
          <button className="browser-consent-enable" onClick={enableAccess}>{t('browser.acknowledge')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );

  return createPortal(
    <div className={`file-sheet browser-sheet ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="browser-tabs" role="tablist" aria-label={t('browser.openTabs')}
        inert={clearConfirmation ? '' : undefined}>
        <button className={`browser-tab browser-history-tab ${historyActive ? 'active' : ''}`} role="tab"
          aria-selected={historyActive} aria-label={t('browser.history')} title={t('browser.history')}
          onClick={selectHistory}>
          <HomeIcon />
        </button>
        <div className="browser-tabs-scroll">
          {tabs.map((tab) => {
            const selected = !historyActive && tab.id === activeId;
            const label = tabLabel(tab);
            return (
              <span ref={selected ? activeTabRef : null}
                className={`browser-tab-wrap ${tab.mode} ${selected ? 'active' : ''}`} key={tab.id}>
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
        <button className="browser-head-button" aria-label={t('browser.minimize')} title={t('browser.minimize')}
          onClick={() => { setOptionsOpen(false); setOpen(false); }}><ChevronDownIcon /></button>
      </div>

      <div className="browser-nav" inert={clearConfirmation ? '' : undefined}>
        <form className="browser-address-form" onSubmit={submitAddress}>
          <GlobeIcon />
          <span className={`browser-address-mode ${menuMode}`}>
            {t(menuMode === 'proxy' ? 'browser.proxyBadge' : 'browser.directBadge')}
          </span>
          <input ref={addressRef} className="browser-address" aria-label={t('browser.address')}
            value={address} onChange={(event) => setAddress(event.target.value)}
            placeholder={t('browser.addressPlaceholder')} autoCapitalize="none" autoCorrect="off" spellCheck="false" />
        </form>
        <button className={`browser-nav-button browser-refresh ${activeLoading ? 'loading' : ''}`}
          aria-label={t(activeLoading && proxied ? 'browser.stop' : 'browser.refresh')} aria-busy={activeLoading}
          disabled={!active || historyActive} onClick={activeLoading && proxied ? stopActive : refreshActive}>
          {activeLoading && proxied ? <StopIcon /> : <RefreshIcon />}
        </button>
        <button className="browser-nav-button browser-options-trigger" aria-label={t('browser.menu')}
          aria-expanded={optionsOpen} onClick={() => setOptionsOpen((value) => !value)}><MoreHorizontalIcon /></button>
        {optionsOpen && open && (
          <>
            <div className="browser-options-backdrop" onClick={() => setOptionsOpen(false)} />
            <div className="browser-options-card" role="dialog" aria-label={t('browser.menu')}>
              <div className="browser-options-section browser-current-mode">
                <strong>{t('browser.connectionMode')}</strong>
                <div className="browser-mode-segment" role="group" aria-label={t('browser.switchMode')}>
                  <button aria-pressed={menuMode === 'direct'}
                    onClick={() => chooseMode('direct')}>{t('browser.directMode')}</button>
                  <button className="proxy" aria-pressed={menuMode === 'proxy'}
                    disabled={!proxyAvailable}
                    aria-describedby={!proxyAvailable ? 'browser-options-proxy-unavailable' : undefined}
                    onClick={() => chooseMode('proxy')}>{t('browser.proxyMode')}</button>
                </div>
                {proxyAvailable
                  ? <p className="browser-options-hint browser-proxy-limit">{t('browser.proxyLimitHint')}</p>
                  : <p id="browser-options-proxy-unavailable"
                    className="browser-options-hint">{t('browser.proxyUnavailable')}</p>}
              </div>

              <div className="browser-options-row">
                <strong>{t('browser.pageView')}</strong>
                <div className="browser-view-segment" role="group" aria-label={t('browser.viewMode')}>
                  <button aria-label={t('browser.mobileView')} aria-pressed={device === 'mobile'}
                    onClick={() => setDevice('mobile')}><SmartphoneIcon /></button>
                  <button aria-label={t('browser.desktopView')} aria-pressed={device === 'desktop'}
                    onClick={() => setDevice('desktop')}><MonitorIcon /></button>
                </div>
              </div>

              <div className="browser-options-section">
                <button className="browser-close-trigger" aria-expanded={timeOpen}
                  onClick={() => setTimeOpen((value) => !value)}>
                  <strong>{t('browser.closeTiming')}</strong>
                  <span>{t('browser.minutes', { value: closeAfter })} ▾</span>
                </button>
                {timeOpen && (
                  <div className="browser-time-options" role="group" aria-label={t('browser.closeTiming')}>
                    {BROWSER_CLOSE_AFTER_OPTIONS.map((value) => (
                      <button key={value} className="browser-time-option" aria-pressed={closeAfter === value}
                        onClick={() => pickTime(value)}>{t('browser.minutes', { value })}</button>
                    ))}
                  </div>
                )}
              </div>

              {proxyAvailable && (historyActive || !active) && (
                <div className="browser-options-section browser-profile-options">
                  <div className="browser-options-row browser-profile-persist">
                    <span className="browser-options-title">
                      <label htmlFor="browser-profile-persist-toggle">
                        <strong>{t('settings.browserPersistLogin')}</strong>
                      </label>
                      <button type="button" className="settings-close browser-title-help"
                        aria-label={t('browser.proxyLoginHelpLabel')}
                        onClick={(event) => {
                          event.preventDefault();
                          clearTriggerRef.current = event.currentTarget;
                          setClearConfirmation({ type: 'help-profile' });
                        }}>?</button>
                    </span>
                    <span className="browser-options-control">
                      <span className="cmd-switch">
                        <input id="browser-profile-persist-toggle" type="checkbox" checked={!!persistProxyLogin}
                          onChange={(event) => setProxyLoginPolicy({
                            persist: event.target.checked,
                            retentionDays: null,
                          })} />
                        <span className="cmd-switch-track" aria-hidden="true" />
                        <span className="cmd-switch-knob" aria-hidden="true" />
                      </span>
                    </span>
                  </div>
                  <button className="browser-options-danger" onClick={() => {
                    clearTriggerRef.current = document.activeElement;
                    setClearConfirmation({ type: 'all' });
                  }}>{t('browser.clearAllLogin')}</button>
                </div>
              )}

              {proxyAvailable && active?.mode === 'proxy' && !historyActive && (
                <div className="browser-options-section">
                  <div className="browser-site-cookie-row">
                    <button className="browser-options-danger" onClick={requestActiveSiteClear}>
                      {t('browser.clearSiteLogin')}
                    </button>
                    <button className="settings-close browser-title-help"
                      aria-label={t('browser.siteCookieHelpLabel')}
                      onClick={(event) => {
                        clearTriggerRef.current = event.currentTarget;
                        setClearConfirmation({ type: 'help-site' });
                      }}>?</button>
                  </div>
                </div>
              )}

              {(historyActive || !active) && (
                <div className="browser-options-section">
                  <button className="browser-options-action" onClick={() => {
                    clearTriggerRef.current = document.activeElement;
                    setClearConfirmation({ type: 'help-about' });
                  }}>{t('browser.about')}</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div ref={bodyRef} className={`browser-content ${device === 'desktop' ? 'desktop' : ''}`}
        inert={clearConfirmation ? '' : undefined}>
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
                      <span className="browser-history-meta">
                        <span className={`browser-history-mode ${entry.lastMode || 'direct'}`}>
                          {t(entry.lastMode === 'proxy' ? 'browser.proxyBadge' : 'browser.directBadge')}
                        </span>
                        <span className="browser-history-url">{entry.url}</span>
                      </span>
                    </button>
                    <button className="browser-history-more" aria-label={t('browser.historyMore')}
                      aria-expanded={historyModeOpen === key}
                      onClick={() => setHistoryModeOpen((value) => value === key ? null : key)}>…</button>
                    {historyModeOpen === key && (
                      <div className="browser-history-mode-menu" role="dialog" aria-label={t('browser.openMode')}>
                        <button className="browser-history-mode-option" onClick={() => openHistory(entry, 'direct', true)}>{t('browser.directMode')}</button>
                        <button className="browser-history-mode-option proxy" disabled={!proxyAvailable}
                          aria-describedby={!proxyAvailable ? `browser-history-proxy-unavailable-${index}` : undefined}
                          onClick={() => openHistory(entry, 'proxy', true)}>{t('browser.proxyMode')}</button>
                        <button className="browser-history-mode-option danger"
                          onClick={() => removeHistory(entry)}>{t('browser.deleteHistoryEntry')}</button>
                        {!proxyAvailable && <p id={`browser-history-proxy-unavailable-${index}`}>{t('browser.proxyUnavailable')}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
        {tabs.filter((tab) => mountedTabs.has(tab.id)).map((tab) => {
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
                onError={() => {
                  if (tab.mode !== 'proxy') return;
                  if (openRef.current && activeIdRef.current === tab.id) void recoverBinding(tab.id);
                  else setUnhealthyTabs((current) => new Set(current).add(tab.id));
                }}
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
        {(error || historyError) && (
          <div className="browser-error" role="alert">
            <span>{historyError || error?.message || t('browser.loadFailed')}</span>
            {!historyError && active && active.mode === 'direct' && proxyAvailable
              ? <button onClick={() => navigateTab(active.id, active.originalUrl, 'proxy')}>{t('browser.tryProxy')}</button>
              : !historyError && active && <button onClick={() => (
                active.mode === 'proxy'
                  ? recoverBinding(active.id)
                  : navigateTab(active.id, active.originalUrl, active.mode)
              )}>{t('browser.retry')}</button>}
          </div>
        )}
      </div>
      {clearConfirmation && (
        <div className="browser-profile-confirm-backdrop">
          <div ref={clearDialogRef} className="browser-profile-confirm"
            role={clearConfirmation.type.startsWith('help-') ? 'dialog' : 'alertdialog'} aria-modal="true"
            aria-label={t(clearConfirmation.type === 'help-about'
              ? 'browser.about'
              : clearConfirmation.type === 'help-profile'
              ? 'browser.proxyLogin'
              : clearConfirmation.type === 'help-site'
                ? 'browser.siteProxyCookie'
                : clearConfirmation.type === 'site'
              ? 'browser.clearSiteLogin'
              : clearConfirmation.type === 'all'
                ? 'browser.clearAllLogin'
                : 'browser.proxyLogin')}>
            {clearConfirmation.type === 'help-about' ? (
              <>
                <h2>{t('browser.about')}</h2>
                <p>{t('browser.consentBody')}</p>
                <ul>
                  <li>{t('browser.consentComputer')}</li>
                  <li>{t('browser.consentPrivate')}</li>
                  <li>{t('browser.consentLimits')}</li>
                  <li>{t('browser.consentIdle')}</li>
                </ul>
              </>
            ) : (
              <p>{t(clearConfirmation.type === 'help-profile'
                ? 'browser.proxyLoginHelp'
                : clearConfirmation.type === 'help-site'
                  ? 'browser.siteCookieHelp'
                  : clearConfirmation.type === 'site'
                    ? 'browser.clearSiteLoginConfirm'
                    : clearConfirmation.type === 'all'
                      ? 'browser.clearAllLoginConfirm'
                      : 'browser.proxyLoginHelp')}</p>
            )}
            <div>
              {clearConfirmation.type.startsWith('help-') ? (
                <button ref={clearCancelRef} onClick={() => setClearConfirmation(null)}>{t('browser.acknowledge')}</button>
              ) : (
                <>
                  <button ref={clearCancelRef} onClick={() => setClearConfirmation(null)}>{t('common.cancel')}</button>
                  <button className="danger" onClick={confirmSiteClear}>{t('common.confirm')}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

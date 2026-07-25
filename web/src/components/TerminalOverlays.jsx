import { shouldKeepKeyboard } from '../dockKeyboard.js';
import { expandToLines, expandToParagraph } from '../terminalSelection.js';
import { t } from '../i18n';
import LensBoot from './LensBoot.jsx';

const CALLOUT_W = 200;

export default function TerminalOverlays({
  ready,
  connectionInfo,
  connected,
  inputFailure,
  dbgVisible,
  dbg,
  scrollInfo,
  selInfo,
  onResume,
  altScreen,
  onPageScroll,
  onFitScreen,
  locateOn,
  onToggleLocate,
  selUI,
  onCopy,
  selActionsRef,
  termRef,
}) {
  return (
    <>
      {!ready && <LensBoot hint={t('boot.loading')} />}
      {connectionInfo && (
        <div className={`terminal-connection is-${connectionInfo.quality}`}>
          <span className="terminal-connection__tag">
            {t(`terminal.transport_${connectionInfo.mode}`)}
          </span>
          <span className="terminal-connection__tag terminal-connection__quality">
            {t(`terminal.connection_${connectionInfo.quality}`)}
          </span>
          <span className="terminal-connection__latency">
            {connectionInfo.rttMs == null ? '-- ms' : `${connectionInfo.rttMs} ms`}
          </span>
        </div>
      )}
      {!connected && (
        <div className="term-banner term-banner--err">
          ⚠ {inputFailure === 'pane-missing' ? t('terminal.paneMissing') : t('terminal.disconnected')}
        </div>
      )}
      {dbgVisible && <div className="dbg">{dbg}</div>}
      {connected && scrollInfo && !selInfo && <div className="term-banner term-banner--hist">{scrollInfo}</div>}
      {selInfo && <div className="term-banner term-banner--sel">{selInfo}</div>}
      {scrollInfo && <button className="new-output" onClick={onResume}>↓ 回到底部</button>}
      {altScreen && (
        <div
          className="term-pager"
          role="group"
          aria-label="翻页"
          onPointerDown={(event) => {
            if (shouldKeepKeyboard(document.activeElement) && event.cancelable) event.preventDefault();
          }}
        >
          <div className="term-pager-grp">
            <button type="button" className="term-pager-btn" aria-label="上翻页" onClick={() => onPageScroll('up')}>
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                <path d="M6 14.5l6-6 6 6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="term-pager-div" aria-hidden="true" />
            <button type="button" className="term-pager-btn" aria-label="下翻页" onClick={() => onPageScroll('down')}>
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                <path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <div className="term-pager-grp">
            <button type="button" className="term-pager-btn" aria-label="适配高度" title="适配高度" onClick={onFitScreen}>
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                <path d="M5 4.5h14M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12 8.5v7M9.8 10.8L12 8.5l2.2 2.3M9.8 13.2L12 15.5l2.2-2.3" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="term-pager-div" aria-hidden="true" />
            <button type="button" className="term-pager-btn" aria-label="定位光标行" title="定位光标行" aria-pressed={locateOn} onClick={onToggleLocate}>
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                <path d="M5 7h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" opacity="0.7" />
                <rect x="4" y="10.5" width="16" height="3" rx="1.5" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {selUI && (() => {
        const minX = Math.min(selUI.start.x, selUI.end.x);
        const minY = Math.min(selUI.start.y, selUI.end.y);
        const maxY = Math.max(selUI.start.y, selUI.end.y);
        const calloutLeft = Math.max(8, Math.min(minX, (selUI.wrapW ?? 0) - CALLOUT_W - 8));
        const aboveY = minY - 44;
        const belowY = maxY + (selUI.start.ch || 0) + 8;
        const calloutTop = aboveY < 4 ? belowY : aboveY;
        return (
          <>
            <div className="sel-handle sel-handle--start"
                 style={{ left: selUI.start.x, top: selUI.start.y, '--h': `${selUI.start.ch}px` }}
                 data-end="start" />
            <div className="sel-handle sel-handle--end"
                 style={{ left: selUI.end.x, top: selUI.end.y, '--h': `${selUI.end.ch}px` }}
                 data-end="end" />
            <div className="sel-callout" style={{ left: calloutLeft, top: calloutTop }}>
              <button type="button" onClick={onCopy}>拷贝</button>
              <button type="button" onClick={() => {
                const actions = selActionsRef.current;
                const term = termRef.current;
                if (actions && term) actions.selectRange(expandToLines(actions.currentRange(), term.cols));
              }}>整行</button>
              <button type="button" onClick={() => {
                const actions = selActionsRef.current;
                const term = termRef.current;
                if (!actions || !term) return;
                const buffer = term.buffer.active;
                actions.selectRange(expandToParagraph(
                  actions.currentRange(),
                  term.cols,
                  actions.paraLineText,
                  0,
                  buffer.length - 1,
                ));
              }}>整段</button>
            </div>
          </>
        );
      })()}
    </>
  );
}

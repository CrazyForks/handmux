import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { getToken } from '../storage.js';
import { cursorSeq, prepareSeed } from '../terminalSeed.js';

const RECONNECT_MS = 1000;
const write = (term, data) => new Promise((resolve) => term.write(data, resolve));

const TerminalStreamTest = forwardRef(function TerminalStreamTest({
  pane,
  desktop = false,
  autoFocusInput = true,
  onAuthFail,
  onTap,
  onRequestDraft,
  onInputFocusChange,
  onInputData,
}, ref) {
  const hostRef = useRef(null);
  const termRef = useRef(null);
  const callbacksRef = useRef({});
  callbacksRef.current = {
    onAuthFail, onTap, onRequestDraft, onInputFocusChange, onInputData,
  };
  const [phase, setPhase] = useState('connecting');

  useImperativeHandle(ref, () => ({
    getSize: () => {
      const term = termRef.current;
      return term ? { cols: term.cols, rows: term.rows } : null;
    },
    focusInput: () => termRef.current?.focus(),
    blurInput: () => termRef.current?.blur(),
    wake: () => {},
    flash: () => {},
    inputFailed: () => setPhase('reconnecting'),
    getFontSize: () => ({ size: termRef.current?.options.fontSize ?? 14, auto: false }),
    setFontSize: (size) => {
      if (termRef.current) termRef.current.options.fontSize = size;
      return size;
    },
    autoFont: () => {},
    setDocHighlight: () => {},
  }), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let disposed = false;
    let socket = null;
    let reconnectTimer = null;
    let writes = Promise.resolve();

    const term = new XTerm({
      cols: 80,
      rows: 24,
      allowProposedApi: true,
      scrollback: 100,
      convertEol: false,
      fontSize: 14,
      fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', 'Noto Sans Mono', 'DejaVu Sans Mono', 'Courier New', monospace",
      theme: { selectionBackground: 'rgba(10,132,255,0.9)', selectionForeground: '#ffffff' },
      cursorInactiveStyle: 'block',
    });
    term.open(host);
    termRef.current = term;
    let webgl;
    try {
      webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch { /* DOM renderer is sufficient for the experiment */ }

    const helper = host.querySelector('.xterm-helper-textarea');
    if (desktop && helper) {
      helper.readOnly = false;
      helper.tabIndex = 0;
      helper.removeAttribute('inputmode');
      helper.removeAttribute('aria-hidden');
    }
    const focus = () => callbacksRef.current.onInputFocusChange?.(true);
    const blur = () => callbacksRef.current.onInputFocusChange?.(false);
    helper?.addEventListener('focus', focus);
    helper?.addEventListener('blur', blur);
    const inputSub = desktop
      ? term.onData((data) => callbacksRef.current.onInputData?.(pane, data))
      : null;
    term.attachCustomKeyEventHandler((event) => {
      if (desktop && event.key === 'Enter' && event.shiftKey
        && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
        event.preventDefault?.();
        callbacksRef.current.onRequestDraft?.();
        return false;
      }
      return true;
    });
    if (desktop && autoFocusInput) term.focus();

    const connect = () => {
      if (disposed) return;
      setPhase('connecting');
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${location.host}/api/terminal-stream`);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'subscribe', token: getToken() ?? '', pane }));
      };
      socket.onmessage = (event) => {
        writes = writes.then(async () => {
          if (typeof event.data !== 'string') {
            await write(term, new Uint8Array(event.data));
            return;
          }
          const message = JSON.parse(event.data);
          if (message.type === 'seed') {
            term.resize(message.width, message.height);
            await write(term, '\x1b[?25l\x1b[0m\x1b[2J\x1b[3J\x1b[H' + prepareSeed(message.ansi));
            term.scrollToBottom();
          } else if (message.type === 'ready') {
            await write(term, cursorSeq(message.cur, term.rows, term.rows));
            setPhase('live');
          }
        }).catch(() => setPhase('reconnecting'));
      };
      socket.onclose = (event) => {
        if (disposed) return;
        if (event.code === 4001) {
          callbacksRef.current.onAuthFail?.();
          return;
        }
        setPhase('reconnecting');
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };
      socket.onerror = () => socket.close();
    };
    connect();

    const tap = () => callbacksRef.current.onTap?.();
    host.addEventListener('pointerdown', tap, { capture: true });
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { socket?.close(); } catch { /* already closed */ }
      host.removeEventListener('pointerdown', tap, { capture: true });
      helper?.removeEventListener('focus', focus);
      helper?.removeEventListener('blur', blur);
      inputSub?.dispose();
      try { webgl?.dispose(); } catch { /* already disposed */ }
      term.dispose();
      termRef.current = null;
    };
  }, [pane, desktop, autoFocusInput]);

  const label = phase === 'live' ? '实时流实验' : phase === 'reconnecting' ? '实时流重连中' : '实时流连接中';
  return (
    <div className="terminal-wrap terminal-stream-test-wrap">
      <div ref={hostRef} className={`terminal terminal-stream-test${desktop ? ' desktop-input' : ''}`} />
      <div className={`terminal-stream-test-badge is-${phase}`}>
        <span aria-hidden="true" />
        {label}
      </div>
    </div>
  );
});

export default TerminalStreamTest;

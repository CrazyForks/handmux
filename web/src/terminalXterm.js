import { Terminal as XTerm } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { docLinksOnLine } from './docDecorations.js';
import { findLocalUrls } from './localUrl.js';
import { ensureBundledFonts } from './bundledFonts.js';

function primeCursorRenderer(term, host) {
  const helper = host?.querySelector('.xterm-helper-textarea');
  if (helper) {
    helper.readOnly = true;
    helper.tabIndex = -1;
    helper.setAttribute('inputmode', 'none');
    helper.setAttribute('aria-hidden', 'true');
  }
  const previousFocus = document.activeElement;
  term.focus();
  term.blur();
  if (previousFocus && previousFocus !== document.body && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
  }
}

function prepareInput(term, host, desktop, autoFocusInput) {
  const helper = host?.querySelector('.xterm-helper-textarea');
  if (!desktop) {
    primeCursorRenderer(term, host);
    return;
  }
  if (helper) {
    helper.readOnly = false;
    helper.tabIndex = 0;
    helper.removeAttribute('inputmode');
    helper.removeAttribute('aria-hidden');
  }
  if (autoFocusInput) term.focus();
}

function usesAppleCommandKey() {
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

export function openXterm({
  host,
  desktop,
  autoFocusInput,
  fontSize,
  scrollback,
  pane,
  onInputData,
  onInputFocusChange,
  onRequestDraft,
  onDesktopSelection,
  getDocLinkHandler,
}) {
  const term = new XTerm({
    disableStdin: !desktop,
    allowProposedApi: true,
    scrollback,
    convertEol: false,
    fontSize,
    fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Monaco, 'Cascadia Mono', 'Roboto Mono', 'Noto Sans Mono', 'DejaVu Sans Mono', 'Courier New', 'JetBrainsMono Nerd Font', 'TW Unifont', monospace",
    theme: { selectionBackground: 'rgba(10,132,255,0.9)', selectionForeground: '#ffffff' },
    cursorInactiveStyle: 'block',
    linkHandler: {
      activate: (event, text) => {
        const local = findLocalUrls(text)[0];
        const handler = getDocLinkHandler?.();
        if (local && handler) {
          handler({
            kind: 'url',
            protocol: local.protocol,
            port: local.port,
            urlPath: local.path,
            raw: local.raw,
            path: local.raw,
          }, event?.clientX ?? 0, event?.clientY ?? 0);
          return;
        }
        try { window.open(text, '_blank', 'noopener,noreferrer'); } catch { /* ignore */ }
      },
    },
  });
  term.open(host);

  term.attachCustomKeyEventHandler((event) => {
    const pasteKey = desktop && event.key?.toLowerCase() === 'v' && !event.altKey;
    const nativePaste = pasteKey && (usesAppleCommandKey()
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey);
    if (nativePaste) return false;

    const copyKey = desktop && event.key?.toLowerCase() === 'c' && term.hasSelection?.();
    const nativeCopy = copyKey && event.metaKey && !event.ctrlKey && !event.altKey;
    const terminalCopy = copyKey && event.ctrlKey && event.shiftKey
      && !event.metaKey && !event.altKey;
    if (nativeCopy || terminalCopy) {
      if (terminalCopy) {
        event.preventDefault?.();
        const text = term.getSelection();
        const fallback = () => {
          try { document.execCommand('copy'); } catch { /* clipboard unavailable */ }
        };
        try {
          const pendingCopy = navigator.clipboard?.writeText?.(text);
          if (pendingCopy) Promise.resolve(pendingCopy).catch(fallback);
          else fallback();
        } catch { fallback(); }
      }
      return false;
    }
    if (desktop && event.key === 'Enter' && event.shiftKey
      && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing) {
      event.preventDefault?.();
      onRequestDraft?.();
      return false;
    }
    if (event.metaKey && ['w', 't', 'l', 'r'].includes(event.key.toLowerCase())) return false;
    return true;
  });

  const dataSub = desktop ? term.onData((data) => onInputData?.(pane, data)) : null;
  const selectionSub = desktop ? term.onSelectionChange(() => onDesktopSelection?.(term.hasSelection())) : null;
  const helper = desktop ? host.querySelector('.xterm-helper-textarea') : null;
  const focus = () => onInputFocusChange?.(true);
  const blur = () => onInputFocusChange?.(false);
  helper?.addEventListener('focus', focus);
  helper?.addEventListener('blur', blur);
  prepareInput(term, host, desktop, autoFocusInput);

  const linkProvider = term.registerLinkProvider({
    provideLinks(lineNo, callback) {
      const handler = getDocLinkHandler?.();
      if (!handler) {
        callback(undefined);
        return;
      }
      const links = docLinksOnLine(term, lineNo).map((link) => ({
        range: link.range,
        text: link.raw ?? link.path,
        decorations: { pointerCursor: true, underline: false },
        activate: (event) => handler(link, event?.clientX ?? 0, event?.clientY ?? 0),
      }));
      callback(links.length ? links : undefined);
    },
  });

  let disposed = false;
  let webgl = null;
  const mountWebgl = () => {
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch { webgl = null; }
  };
  mountWebgl();
  ensureBundledFonts(fontSize).then(() => {
    if (disposed || !webgl) return;
    try { webgl.dispose(); } catch { /* already disposed */ }
    mountWebgl();
    term.refresh(0, term.rows - 1);
  });

  return {
    term,
    dispose() {
      disposed = true;
      dataSub?.dispose();
      selectionSub?.dispose();
      helper?.removeEventListener('focus', focus);
      helper?.removeEventListener('blur', blur);
      linkProvider.dispose();
      try { webgl?.dispose(); } catch { /* already disposed */ }
      term.dispose();
    },
  };
}

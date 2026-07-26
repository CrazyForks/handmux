const EDITABLE_TARGET = [
  'input',
  'textarea',
  'select',
  '[role="textbox"]',
  '[contenteditable]:not([contenteditable="false"])',
].join(',');

export function isBrowserFunctionKey(event) {
  return event.key === 'F5' || event.key === 'F12';
}

export function isDraftShortcut(event) {
  return event.key === 'Enter' && event.shiftKey
    && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing;
}

export function shouldRouteTerminalPageKey(event) {
  if (event.defaultPrevented || event.isComposing || isBrowserFunctionKey(event)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest('.xterm-helper-textarea')) return false;
  return !target.closest(EDITABLE_TARGET);
}

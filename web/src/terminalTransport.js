const TERMINAL_TRANSPORT_KEY = 'tw_terminal_transport';

export function getTerminalTransport(store = localStorage) {
  return store.getItem(TERMINAL_TRANSPORT_KEY) === 'snapshot' ? 'snapshot' : 'live';
}

export function setTerminalTransport(mode, store = localStorage) {
  const next = mode === 'snapshot' ? 'snapshot' : 'live';
  store.setItem(TERMINAL_TRANSPORT_KEY, next);
  return next;
}

export function terminalStreamEnabled(locationLike = window.location, mode = 'live') {
  const override = new URLSearchParams(locationLike.search).get('terminalStream');
  if (override === '0') return false;
  return mode !== 'snapshot';
}

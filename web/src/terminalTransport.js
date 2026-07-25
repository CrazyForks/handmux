const TERMINAL_TRANSPORT_KEY = 'tw_terminal_transport';
const SNAPSHOT_INTERVAL_KEY = 'tw_terminal_snapshot_interval';
export const SNAPSHOT_INTERVALS = [800, 1000, 1200, 1500, 2000];
export const DEFAULT_SNAPSHOT_INTERVAL = 1000;

export function getTerminalTransport(store = localStorage) {
  return store.getItem(TERMINAL_TRANSPORT_KEY) === 'snapshot' ? 'snapshot' : 'live';
}

export function setTerminalTransport(mode, store = localStorage) {
  const next = mode === 'snapshot' ? 'snapshot' : 'live';
  store.setItem(TERMINAL_TRANSPORT_KEY, next);
  return next;
}

export function getSnapshotInterval(store = localStorage) {
  const value = Number(store.getItem(SNAPSHOT_INTERVAL_KEY));
  return SNAPSHOT_INTERVALS.includes(value) ? value : DEFAULT_SNAPSHOT_INTERVAL;
}

export function setSnapshotInterval(intervalMs, store = localStorage) {
  const value = Number(intervalMs);
  const next = SNAPSHOT_INTERVALS.includes(value) ? value : DEFAULT_SNAPSHOT_INTERVAL;
  store.setItem(SNAPSHOT_INTERVAL_KEY, String(next));
  return next;
}

export function terminalStreamEnabled(locationLike = window.location, mode = 'live') {
  const override = new URLSearchParams(locationLike.search).get('terminalStream');
  if (override === '0') return false;
  return mode !== 'snapshot';
}

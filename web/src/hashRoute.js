// Session deep-link via the URL hash: `host/#<session-name>`. tmux session names are unique,
// so the name is a safe, readable routing key. Pure (window.location/history only) so it
// unit-tests on its own. We read the hash on load and write it on session change; we don't
// listen for live hashchange (YAGNI).

export function readSessionHash() {
  const raw = location.hash.replace(/^#/, '');
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// replaceState (not assigning location.hash) so switching sessions doesn't pile up history
// entries / hijack the back button. Refresh still resolves the hash on load. We PRESERVE the
// current entry's state (pass history.state, not null): the top entry is often the useExitConfirm
// guard ({exitGuard}) or a useBackButton overlay ({overlay}), and openSession writes the hash right
// on top of it. Nulling that marker desyncs the back-button state machines (spurious "press again to
// exit", silent exits, several backs needed before the app closes).
export function writeSessionHash(name) {
  history.replaceState(history.state, '', `#${encodeURIComponent(name)}`);
}

// Deep-link route: `#/s/<session>/w/<window>/p/<pane>`, each segment URL-encoded (pane ids contain
// '%', so encoding is mandatory). Falls back to the legacy `#<session-name>` form. Returns
// {session, window, pane} with window/pane null when the deep-link form isn't present.
const dec = (x) => { try { return decodeURIComponent(x); } catch { return x; } };

export function readRoute() {
  const raw = location.hash.replace(/^#/, '');
  const inboxM = raw.match(/^\/inbox(?:\/(.*))?$/);
  if (inboxM) return { session: null, window: null, pane: null, inbox: true, inboxId: inboxM[1] ? dec(inboxM[1]) : null };
  const m = raw.match(/^\/s\/([^/]*)\/w\/([^/]*)\/p\/(.*)$/);
  if (m) return { session: dec(m[1]), window: dec(m[2]), pane: dec(m[3]), inbox: false, inboxId: null };
  const session = dec(raw);
  return { session: session || null, window: null, pane: null, inbox: false, inboxId: null };
}

export function buildDeepLink({ session, window, pane }) {
  const e = encodeURIComponent;
  return `#/s/${e(session)}/w/${e(window)}/p/${e(pane)}`;
}

// Inbox route: `#/inbox` (list) or `#/inbox/<id>` (detail), id URL-encoded.
export function buildInboxLink(id) {
  return id ? `#/inbox/${encodeURIComponent(id)}` : '#/inbox';
}

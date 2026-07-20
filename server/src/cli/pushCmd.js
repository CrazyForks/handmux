// `handmux push <title> <body> [--session X]... [--device K]... [--tag T] [--url U]` — fire one
// notification to the phone through the already-running server (loopback + the server's own token).
// Scope is mutually exclusive: --device (by key) or --session, else all. Pure parse + injectable
// runner so it unit-tests without spawning or real fetch.
import { readState } from './state.js';
import { sanitizeNotificationUrl } from '../urlPolicy.js';

const collect = (acc, v) => acc.concat(String(v).split(',').map((s) => s.trim()).filter(Boolean));

// argv is process.argv.slice(2), i.e. ['push', title, body, ...flags]. The shared parseArgs() drops bare
// words after the command, so title/body are taken positionally; --session/--device may repeat.
export function parsePushArgs(argv) {
  const rest = argv.slice(1);
  const positional = [];
  let sessions = [], devices = [], tag, url;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--session') { sessions = collect(sessions, rest[++i]); }
    else if (a === '--device') { devices = collect(devices, rest[++i]); }
    else if (a === '--tag') { tag = rest[++i]; }
    else if (a === '--url') { url = rest[++i]; }
    else if (!a.startsWith('--')) positional.push(a);
  }
  const [title, body] = positional;
  if (!title || !body) return { error: 'usage: handmux push <title> <body> [--session X]... [--device K]... [--tag T] [--url U]' };
  if (sessions.length && devices.length) return { error: 'use --session or --device, not both' };
  const safeUrl = url == null ? null : sanitizeNotificationUrl(url);
  if (url != null && !safeUrl) return { error: '--url must be an http(s) URL or a relative path' };
  const out = { title, body };
  if (sessions.length) out.sessions = sessions;
  if (devices.length) out.devices = devices;
  if (tag) out.tag = tag;
  if (safeUrl) out.url = safeUrl;
  return out;
}

export async function runPush({ argv, home, fetchImpl = globalThis.fetch, log = console.log, err = console.error }) {
  const parsed = parsePushArgs(argv);
  if (parsed.error) { err(parsed.error); return 1; }
  const st = readState(home);
  if (!st || !st.localUrl || !st.token) { err('handmux is not running — run `handmux start` first.'); return 1; }
  try {
    const res = await fetchImpl(`${st.localUrl}/api/push/send-local`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${st.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    if (!res.ok) { err(`push failed: ${res.status}`); return 1; }
    const out = await res.json();
    if (out.configured === false) { err('push is not configured (no VAPID keys) — run `handmux setup`.'); return 1; }
    const sent = Number.isFinite(out.sent) ? out.sent : 0;
    const failed = Number.isFinite(out.failed) ? out.failed : 0;
    const gone = Number.isFinite(out.gone) ? out.gone : 0;
    const counts = `sent: ${sent}, failed: ${failed}, gone: ${gone}`;
    if (sent === 0) { err(`no notification delivered (${counts})`); return 1; }
    if (failed > 0) { err(`push partially failed (${counts})`); return 1; }
    log(`pushed (${counts})`);
    return 0;
  } catch (e) { err(`push failed: ${e.message}`); return 1; }
}

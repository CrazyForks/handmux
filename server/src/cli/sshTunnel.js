// Pure: detect tunlite `run --json` reaching the `connected` state from an NDJSON log chunk. tunlite
// self-reconnects, so we only flip to "live" on a real connected event (mirrors cloudflare URL-scrape:
// don't surface the public URL until the tunnel is actually up). Side-effect-free → unit-tested against
// real captured NDJSON lines.
export function isTunnelConnected(text) {
  for (const line of String(text || '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { if (JSON.parse(s).state === 'connected') return true; } catch { /* partial / non-json line */ }
  }
  return false;
}

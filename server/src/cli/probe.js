// Read-only reachability check: after the tunnel reports live, GET the public URL from THIS machine to
// confirm the whole chain (edge/reverse-proxy → tunnel → server) actually answers. Touches no remote
// config — it just fills the "tunnel connected but page won't load" blind spot.
export async function probe(url, { fetchImpl = globalThis.fetch, timeoutMs = 6000 } = {}) {
  if (!url) return false;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ac.signal });
    return true;            // any HTTP response (even 401/404) means the chain is reachable
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

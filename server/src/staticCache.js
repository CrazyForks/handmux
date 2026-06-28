// Cache-Control policy for the static web bundle. index.html and the service worker must NEVER be
// HTTP-cached — an installed PWA would otherwise keep loading a stale shell (pointing at missing
// hashed assets) or a stale SW. Everything else under dist carries a content hash in its name, so
// it's safe to cache forever. Pure so it unit-tests on its own.
export function cacheControlFor(filePath) {
  if (filePath.endsWith('.html') || filePath.endsWith('/sw.js')) return 'no-store';
  return 'public, max-age=31536000, immutable';
}

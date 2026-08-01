import compression from 'compression';

const compress = compression({ threshold: 1024 });

// Only compress Vite's content-hashed frontend assets. API responses keep their existing
// latency/streaming behavior, while the large JS/CSS needed for first paint becomes much smaller.
export function compressStaticAssets(req, res, next) {
  if (!req.path.startsWith('/assets/')) return next();
  return compress(req, res, next);
}

export const STREAM_PAINT_INTERVAL_MS = 33;

export function streamPaintDelay({
  now,
  lastPaintAt,
  immediate = false,
  intervalMs = STREAM_PAINT_INTERVAL_MS,
}) {
  if (immediate || !Number.isFinite(lastPaintAt)) return 0;
  return Math.max(0, intervalMs - Math.max(0, now - lastPaintAt));
}

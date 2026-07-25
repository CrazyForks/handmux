const toHex = (bytes) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const MAX_BATCH_HEX_LENGTH = 16384 * 2;

export function createTerminalInputQueue({
  send,
  onDelivered = () => {},
  onError = () => {},
  encoder = new TextEncoder(),
}) {
  let staged = [];
  let batches = [];
  let scheduled = false;
  let running = false;
  let disposed = false;

  const callSafely = (callback, ...args) => {
    try {
      callback(...args);
    } catch {
      // Notification callbacks must not alter delivery or queue state.
    }
  };

  const pump = async () => {
    if (running || disposed || batches.length === 0) return;
    running = true;
    try {
      while (!disposed && batches.length) {
        const batch = batches.shift();
        try {
          await send(batch.pane, batch.hex);
        } catch (error) {
          batches = batches.filter((item) => item.pane !== batch.pane);
          staged = staged.filter((item) => item.pane !== batch.pane);
          callSafely(onError, error, batch.pane);
          continue;
        }
        callSafely(onDelivered, batch.pane);
      }
    } finally {
      running = false;
    }
  };

  const flush = () => {
    scheduled = false;
    const items = staged;
    staged = [];
    for (const item of items) {
      let hex = item.hex;
      while (hex) {
        const last = batches.at(-1);
        if (last?.pane === item.pane && last.hex.length < MAX_BATCH_HEX_LENGTH) {
          const available = MAX_BATCH_HEX_LENGTH - last.hex.length;
          last.hex += hex.slice(0, available);
          hex = hex.slice(available);
        } else {
          batches.push({ pane: item.pane, hex: hex.slice(0, MAX_BATCH_HEX_LENGTH) });
          hex = hex.slice(MAX_BATCH_HEX_LENGTH);
        }
      }
    }
    void pump();
  };

  return {
    enqueue(pane, data) {
      if (disposed || !pane || !data) return;
      const bytes = typeof data === 'string'
        ? encoder.encode(data)
        : data instanceof Uint8Array
          ? data
          : new Uint8Array(data);
      staged.push({ pane, hex: toHex(bytes) });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    },
    drop(pane) {
      staged = staged.filter((item) => item.pane !== pane);
      batches = batches.filter((item) => item.pane !== pane);
    },
    dispose() {
      disposed = true;
      staged = [];
      batches = [];
    },
  };
}

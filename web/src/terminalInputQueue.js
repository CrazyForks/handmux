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

  const pump = async () => {
    if (running || disposed || batches.length === 0) return;
    running = true;
    while (!disposed && batches.length) {
      const batch = batches.shift();
      try {
        await send(batch.pane, batch.hex);
        onDelivered(batch.pane);
      } catch (error) {
        batches = batches.filter((item) => item.pane !== batch.pane);
        staged = staged.filter((item) => item.pane !== batch.pane);
        onError(error, batch.pane);
      }
    }
    running = false;
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
      staged.push({ pane, hex: toHex(encoder.encode(data)) });
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

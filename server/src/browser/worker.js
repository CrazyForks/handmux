import { createBrowserWorkerServer } from './workerServer.js';

const internalToken = process.env.HANDMUX_BROWSER_INTERNAL_TOKEN;
const previewDomain = process.env.HANDMUX_PREVIEW_DOMAIN || null;

let worker = null;
let shutdownPromise = null;

async function shutdown(code = 0) {
  if (!shutdownPromise) {
    shutdownPromise = (async () => {
      await worker?.close();
      process.exit(code);
    })();
  }
  return shutdownPromise;
}

process.once('SIGINT', () => { shutdown().catch(() => process.exit(1)); });
process.once('SIGTERM', () => { shutdown().catch(() => process.exit(1)); });
process.once('disconnect', () => { shutdown().catch(() => process.exit(1)); });

try {
  worker = await createBrowserWorkerServer({ internalToken, previewDomain });
  process.send?.({ type: 'handmux-browser-ready', port: worker.port });
} catch (error) {
  console.error(`[handmux] browser worker failed to start: ${error?.message || error}`);
  process.exit(1);
}

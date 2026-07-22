import http from 'node:http';
import express from 'express';
import { tokenEquals } from '../auth.js';
import { createBrowserPreviewManager } from './manager.js';
import { createBrowserBootstrapStore } from './bootstrap.js';
import { createBrowserPublicProxy } from './publicProxy.js';
import { browserRoutes } from './routes.js';
import { BROWSER_INTERNAL_HEADER } from './protocol.js';

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || String(address || '').startsWith('::ffff:127.');
}

function authenticated(req, token) {
  const provided = req.headers[BROWSER_INTERNAL_HEADER];
  return isLoopback(req.socket?.remoteAddress)
    && typeof provided === 'string'
    && tokenEquals(provided, token);
}

export async function createBrowserWorkerServer({
  internalToken,
  previewDomain = null,
  browser: suppliedBrowser = null,
  managerFactory = createBrowserPreviewManager,
  browserPublicFactory = createBrowserPublicProxy,
  host = '127.0.0.1',
  port = 0,
} = {}) {
  if (!internalToken) throw new Error('browser worker internal token required');
  const browser = suppliedBrowser || await managerFactory();
  const browserBootstrap = createBrowserBootstrapStore();
  const browserPublic = browserPublicFactory({ browser, browserBootstrap });
  const app = express();

  app.use((req, res, next) => {
    if (!authenticated(req, internalToken)) return res.status(401).json({ error: 'browser worker unauthorized' });
    delete req.headers[BROWSER_INTERNAL_HEADER];
    next();
  });
  app.get('/_browser-worker/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', express.json(), browserRoutes({ browser, previewDomain, browserBootstrap }));
  app.use(browserPublic.handler);

  const server = http.createServer(app);
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    if (!authenticated(req, internalToken)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return;
    }
    delete req.headers[BROWSER_INTERNAL_HEADER];
    if (!browserPublic.onUpgrade(req, socket, head)) socket.destroy();
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  let closePromise = null;
  return {
    host,
    port: server.address().port,
    server,
    browser,
    close() {
      if (!closePromise) {
        closePromise = (async () => {
          const stopped = new Promise((resolve) => server.close(resolve));
          server.closeIdleConnections?.();
          for (const socket of sockets) socket.destroy();
          try { await browser.close?.(); } finally {
            server.closeAllConnections?.();
            await stopped;
          }
        })();
      }
      return closePromise;
    },
  };
}

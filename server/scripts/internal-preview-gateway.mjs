#!/usr/bin/env node
// Disposable validation gateway for opening a machine-reachable URL through Handmux's existing
// dynamic preview. It intentionally stays outside the Handmux app/CLI: stop the process and all
// target cookies and discovered origins disappear.
import http from 'node:http';
import {
  createInternalPreviewGateway,
  parseInternalPreviewArgs,
} from '../src/internalPreviewGateway.js';

function usage() {
  return 'Usage: node server/scripts/internal-preview-gateway.mjs <http(s)://URL> [--port 4319] [--cookie-domain company.internal] [--insecure]';
}

let options;
try {
  options = parseInternalPreviewArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}

const gateway = createInternalPreviewGateway(options);
const server = http.createServer(gateway.handler);
const sockets = new Set();
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.once('close', () => sockets.delete(socket));
});
server.on('upgrade', gateway.onUpgrade);
server.on('error', (error) => {
  console.error(`Internal preview gateway failed: ${error.message}`);
  process.exitCode = 1;
});
server.listen(options.port, '127.0.0.1', () => {
  console.log('Handmux internal preview validation gateway');
  console.log(`Target: ${options.entryUrl}`);
  console.log(`Open in Handmux: http://localhost:${options.port}`);
  if (options.insecure) console.warn('TLS verification is disabled for this validation process.');
  if (options.cookieDomains.length) console.log(`Shared-cookie domains: ${options.cookieDomains.join(', ')}`);
  console.warn('Validation only: proxied pages may access any machine-reachable LAN host.');
  console.warn('Loopback, link-local, and metadata addresses are blocked. Open only a site you trust.');
  console.log('Press Ctrl-C to stop and clear all in-memory cookies.');
});

function shutdown() {
  server.close(() => process.exit(0));
  for (const socket of sockets) socket.destroy();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PATCHED = Symbol.for('handmux.hammerhead.websocket-upgrade-socket');
const RESPONDER_PATCHED = Symbol.for('handmux.hammerhead.websocket-mock-response');
const REQUEST_INFO_PATCHED = Symbol.for('handmux.hammerhead.request-info-frame-nature');

export function patchHammerheadDestinationRequest(DestinationRequest) {
  const prototype = DestinationRequest?.prototype;
  const original = prototype?._onUpgrade;
  if (typeof original !== 'function' || original.length !== 3) {
    throw new Error('unsupported Hammerhead DestinationRequest._onUpgrade signature');
  }
  if (original[PATCHED]) return false;

  function onUpgrade(response, socket, head) {
    if (response) response.socket ??= socket;
    return original.call(this, response, socket, head);
  }
  Object.defineProperty(onUpgrade, PATCHED, { value: true });
  prototype._onUpgrade = onUpgrade;
  return true;
}

export function patchHammerheadWebSocketResponder(websocket, headerTransforms) {
  const original = websocket?.respondOnWebSocket;
  if (typeof original !== 'function') {
    throw new Error('unsupported Hammerhead WebSocket responder');
  }
  if (original[RESPONDER_PATCHED]) return false;

  function respondOnWebSocket(ctx) {
    if (ctx?.destRes?.socket) return original(ctx);
    const response = ctx?.res;
    const destination = ctx?.destRes;
    if (!destination || typeof response?.end !== 'function') return original(ctx);

    const headers = headerTransforms.forResponse(ctx);
    const missingUpgradeSocket = destination.statusCode === 101;
    const statusCode = missingUpgradeSocket ? 502 : destination.statusCode || 502;
    const statusMessage = missingUpgradeSocket ? 'Bad Gateway' : destination.statusMessage || 'Bad Gateway';
    const lines = [`HTTP/${destination.httpVersion || '1.1'} ${statusCode} ${statusMessage}`];
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) value.forEach((item) => lines.push(`${name}: ${item}`));
      else if (value != null) lines.push(`${name}: ${value}`);
    }
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'connection')) {
      lines.push('connection: close');
    }
    response.end(`${lines.join('\r\n')}\r\n\r\n`);
    return undefined;
  }
  Object.defineProperty(respondOnWebSocket, RESPONDER_PATCHED, { value: true });
  websocket.respondOnWebSocket = respondOnWebSocket;
  return true;
}

export function patchHammerheadRequestInfo(RequestInfo) {
  const original = RequestInfo?.from;
  if (typeof original !== 'function') {
    throw new Error('unsupported Hammerhead RequestInfo.from');
  }
  if (original[REQUEST_INFO_PATCHED]) return false;

  function from(ctx) {
    const info = original.call(this, ctx);
    info.isIframe = !!ctx?.isIframe;
    return info;
  }
  Object.defineProperty(from, REQUEST_INFO_PATCHED, { value: true });
  RequestInfo.from = from;
  return true;
}

export function installHammerheadWebSocketUpgradeCompat() {
  const DestinationRequest = require('testcafe-hammerhead/lib/request-pipeline/destination-request');
  const websocket = require('testcafe-hammerhead/lib/request-pipeline/websocket');
  const headerTransforms = require('testcafe-hammerhead/lib/request-pipeline/header-transforms');
  const { RequestInfo } = require(
    'testcafe-hammerhead/lib/request-pipeline/request-hooks/events/info',
  );
  const destinationPatched = patchHammerheadDestinationRequest(DestinationRequest);
  const responderPatched = patchHammerheadWebSocketResponder(websocket, headerTransforms);
  const requestInfoPatched = patchHammerheadRequestInfo(RequestInfo);
  return destinationPatched || responderPatched || requestInfoPatched;
}

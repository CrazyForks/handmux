import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PATCHED = Symbol.for('handmux.hammerhead.websocket-upgrade-socket');

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

export function installHammerheadWebSocketUpgradeCompat() {
  const DestinationRequest = require('testcafe-hammerhead/lib/request-pipeline/destination-request');
  return patchHammerheadDestinationRequest(DestinationRequest);
}

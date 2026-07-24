import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MARKER = 'x-handmux-browser-rebind';
const PATCHED = Symbol.for('handmux.hammerhead.raw-rebind-location');

export function patchHammerheadRebindLocation(responseTransforms) {
  const original = responseTransforms?.location;
  if (typeof original !== 'function') throw new Error('unsupported Hammerhead location transform');
  if (original[PATCHED]) return false;

  function location(src, ctx) {
    if (ctx?.destRes?.headers?.[MARKER] === '1') return src;
    return original(src, ctx);
  }
  Object.defineProperty(location, PATCHED, { value: true });
  responseTransforms.location = location;
  responseTransforms[MARKER] = () => undefined;
  return true;
}

export function installHammerheadRebindLocationCompat() {
  const { responseTransforms } = require(
    'testcafe-hammerhead/lib/request-pipeline/header-transforms/transforms',
  );
  return patchHammerheadRebindLocation(responseTransforms);
}

export { MARKER as HAMMERHEAD_REBIND_HEADER };

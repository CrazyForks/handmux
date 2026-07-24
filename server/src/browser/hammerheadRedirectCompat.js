import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const MARKER = 'x-handmux-browser-rebind';
const MARKER_SECRET = randomBytes(32).toString('base64url');
const PATCHED = Symbol.for('handmux.hammerhead.raw-rebind-location');

export function hammerheadRebindHeaders(location) {
  return { location, [MARKER]: MARKER_SECRET };
}

export function patchHammerheadRebindLocation(
  responseTransforms,
  markerSecret = MARKER_SECRET,
) {
  const original = responseTransforms?.location;
  if (typeof original !== 'function') throw new Error('unsupported Hammerhead location transform');
  if (original[PATCHED]) return false;

  function location(src, ctx) {
    if (ctx?.destRes?.headers?.[MARKER] === markerSecret) return src;
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
  return patchHammerheadRebindLocation(responseTransforms, MARKER_SECRET);
}

export { MARKER as HAMMERHEAD_REBIND_HEADER };

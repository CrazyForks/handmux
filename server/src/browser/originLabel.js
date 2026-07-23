import { createHash } from 'node:crypto';

export function browserLabelForOrigin(rawOrigin) {
  const origin = new URL(rawOrigin).origin;
  const value = createHash('sha256').update(origin).digest().readBigUInt64BE(0);
  return `b-${value.toString(36).padStart(13, '0')}`;
}

export function claimPublicOrigin(claims, publicOrigin, targetOrigin) {
  const normalizedPublic = new URL(publicOrigin).origin;
  const normalizedTarget = new URL(targetOrigin).origin;
  const existing = claims.get(normalizedPublic);
  if (existing && existing !== normalizedTarget) {
    throw new Error('browser public origin collision');
  }
  claims.set(normalizedPublic, normalizedTarget);
}

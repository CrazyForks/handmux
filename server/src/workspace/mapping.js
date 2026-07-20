import crypto from 'node:crypto';

const HASH = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUNTIME_ID = {
  sessions: /^\$\d+$/,
  windows: /^@\d+$/,
  panes: /^%\d+$/,
};

function fail(message) {
  throw new Error(`invalid recovery mapping: ${message}`);
}

function requireExactObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  const keys = Object.keys(value);
  if (keys.length !== fields.length || fields.some((field) => !keys.includes(field))) fail(`${label} fields are invalid`);
  return value;
}

function validateRecord(value, label, keyPattern, valuePattern) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label} must be a plain object`);
  for (const [key, entry] of Object.entries(value)) {
    if (!keyPattern.test(key) || typeof entry !== 'string' || !valuePattern.test(entry)) fail(`${label} entry is invalid`);
  }
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
}

function payload(mapping) {
  return {
    checkpointId: mapping.checkpointId,
    names: mapping.names,
    runtime: mapping.runtime,
    logical: mapping.logical,
  };
}

function mappingId(mapping) {
  return crypto.createHash('sha256').update(JSON.stringify(sorted(payload(mapping)))).digest('hex');
}

function blankMapping(checkpointId) {
  return {
    checkpointId,
    names: {},
    runtime: { sessions: {}, windows: {}, panes: {} },
    logical: { sessions: {}, windows: {}, panes: {} },
  };
}

function validatePayload(mapping, checkpointId) {
  if (typeof mapping.checkpointId !== 'string' || !mapping.checkpointId || mapping.checkpointId !== checkpointId) {
    fail('checkpoint id mismatch');
  }
  if (!mapping.names || typeof mapping.names !== 'object' || Array.isArray(mapping.names)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(mapping.names))) fail('names must be a plain object');
  for (const [source, target] of Object.entries(mapping.names)) {
    if (!source || ['__proto__', 'constructor', 'prototype'].includes(source) || typeof target !== 'string' || !target) fail('name entry is invalid');
  }
  for (const group of ['runtime', 'logical']) {
    requireExactObject(mapping[group], ['sessions', 'windows', 'panes'], group);
  }
  for (const kind of ['sessions', 'windows', 'panes']) {
    validateRecord(mapping.runtime[kind], `runtime.${kind}`, RUNTIME_ID[kind], RUNTIME_ID[kind]);
    validateRecord(mapping.logical[kind], `logical.${kind}`, UUID, RUNTIME_ID[kind]);
  }
}

export function validateRecoveryMapping(mapping, checkpointId) {
  requireExactObject(mapping, ['id', 'checkpointId', 'restoredAt', 'names', 'runtime', 'logical'], 'mapping');
  if (typeof mapping.id !== 'string' || !HASH.test(mapping.id)) fail('id is invalid');
  if (typeof mapping.restoredAt !== 'string' || Number.isNaN(Date.parse(mapping.restoredAt))) fail('restoredAt is invalid');
  validatePayload(mapping, checkpointId);
  if (mapping.id !== mappingId(mapping)) fail('hash mismatch');
  return mapping;
}

function merge(target, source) {
  Object.assign(target.names, source.names);
  for (const kind of ['sessions', 'windows', 'panes']) {
    Object.assign(target.runtime[kind], source.runtime[kind]);
    Object.assign(target.logical[kind], source.logical[kind]);
  }
}

function validateAddition(value, checkpointId) {
  requireExactObject(value, ['names', 'runtime', 'logical'], 'mapping addition');
  validatePayload({ checkpointId, ...value }, checkpointId);
  return value;
}

function hasValues(mapping) {
  return Object.keys(mapping.names).length > 0
    || ['sessions', 'windows', 'panes'].some((kind) => (
      Object.keys(mapping.runtime[kind]).length > 0 || Object.keys(mapping.logical[kind]).length > 0
    ));
}

export function buildRecoveryMapping(checkpointId, previous, additions, now = Date.now) {
  const combined = blankMapping(checkpointId);
  if (previous) merge(combined, validateRecoveryMapping(previous, checkpointId));
  if (!Array.isArray(additions)) fail('additions must be an array');
  for (const addition of additions) {
    if (addition !== null && addition !== undefined) merge(combined, validateAddition(addition, checkpointId));
  }
  if (!hasValues(combined)) return null;
  const mapping = {
    id: mappingId(combined),
    checkpointId,
    restoredAt: new Date(now()).toISOString(),
    names: combined.names,
    runtime: combined.runtime,
    logical: combined.logical,
  };
  return validateRecoveryMapping(mapping, checkpointId);
}

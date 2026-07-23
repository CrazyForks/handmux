import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes as nodeRandomBytes,
} from 'node:crypto';
import defaultFs from 'node:fs/promises';
import path from 'node:path';

const AUTHENTICATION_ERROR = 'browser profile authentication failed';

function profileHash(deviceId) {
  return createHash('sha256').update(deviceId).digest('hex');
}

function authenticationError() {
  return new Error(AUTHENTICATION_ERROR);
}

export function createBrowserProfilePersistence({
  dir,
  keyFile,
  fs = defaultFs,
  randomBytes = nodeRandomBytes,
}) {
  let keyPromise = null;
  const pending = new Set();

  const ensureDir = async () => {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.chmod(dir, 0o700);
  };

  const loadKey = async () => {
    await ensureDir();
    try {
      const key = await fs.readFile(keyFile);
      if (key.length !== 32) throw authenticationError();
      return key;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const key = randomBytes(32);
    let handle;
    try {
      handle = await fs.open(keyFile, 'wx', 0o600);
      await handle.writeFile(key);
      await handle.sync();
      await handle.close();
      handle = null;
      return key;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === 'EEXIST') {
        const existing = await fs.readFile(keyFile);
        if (existing.length !== 32) throw authenticationError();
        return existing;
      }
      await fs.unlink(keyFile).catch(() => {});
      throw error;
    }
  };

  const key = () => {
    if (!keyPromise) keyPromise = loadKey();
    return keyPromise;
  };
  const profilePath = (deviceId) => path.join(dir, `${profileHash(deviceId)}.profile`);

  const track = (operation) => {
    pending.add(operation);
    operation.then(
      () => pending.delete(operation),
      () => pending.delete(operation),
    );
    return operation;
  };

  const read = async (deviceId) => {
    let raw;
    try {
      raw = await fs.readFile(profilePath(deviceId), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }

    try {
      const deviceHash = profileHash(deviceId);
      const envelope = JSON.parse(raw);
      if (envelope?.v !== 1
        || typeof envelope.iv !== 'string'
        || typeof envelope.tag !== 'string'
        || typeof envelope.data !== 'string') {
        throw authenticationError();
      }
      const iv = Buffer.from(envelope.iv, 'base64');
      const tag = Buffer.from(envelope.tag, 'base64');
      if (iv.length !== 12 || tag.length !== 16) throw authenticationError();
      const decipher = createDecipheriv('aes-256-gcm', await key(), iv);
      decipher.setAAD(Buffer.from(`handmux-browser-profile:v1:${deviceHash}`));
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(envelope.data, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw authenticationError();
    }
  };

  const write = (deviceId, serializedJar) => track((async () => {
    const deviceHash = profileHash(deviceId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await key(), iv);
    cipher.setAAD(Buffer.from(`handmux-browser-profile:v1:${deviceHash}`));
    const encrypted = Buffer.concat([
      cipher.update(serializedJar, 'utf8'),
      cipher.final(),
    ]);
    const envelope = {
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    };
    const target = profilePath(deviceId);
    const temp = `${target}.tmp-${process.pid}-${randomBytes(12).toString('hex')}`;
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(envelope), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fs.rename(temp, target);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.unlink(temp).catch(() => {});
      throw error;
    }
  })());

  const remove = (deviceId) => track(
    fs.unlink(profilePath(deviceId)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    }),
  );

  const close = async () => {
    const results = await Promise.allSettled([...pending]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  };

  return { read, write, remove, close };
}

const MUTATION_METHODS = ['setByServer', 'setByClient', 'setCookies', 'deleteCookies'];
const DAY = 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY = 2_147_483_647;

const noPersistence = {
  async read() { return null; },
  async write() {},
  async remove() {},
  async close() {},
};

export function createDeviceCookieProfiles({
  createCookies,
  onMutation = () => {},
  persistence = noPersistence,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  const profiles = new Map();
  const pending = new Set();

  const track = (operation) => {
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  };

  const profileFor = (deviceId) => {
    let profile = profiles.get(deviceId);
    if (!profile) {
      profile = {
        cookies: createCookies(),
        attached: new Set(),
        persist: false,
        retentionDays: 30,
        loaded: false,
        used: false,
        active: false,
        idleSince: null,
        retentionTimer: null,
        flushTimer: null,
        dirty: false,
        writePromise: Promise.resolve(),
      };
      profiles.set(deviceId, profile);
    }
    return profile;
  };

  const installCookies = (profile, cookies) => {
    profile.cookies = cookies;
    for (const attached of profile.attached) {
      attached._cookieJar = cookies._cookieJar;
      attached._pendingSyncCookies = [];
    }
  };

  const replaceJar = (profile, serialized) => {
    profile.cookies.setJar(serialized);
    for (const cookies of profile.attached) {
      cookies._cookieJar = profile.cookies._cookieJar;
      cookies._pendingSyncCookies = [];
    }
  };

  const queueWrite = (deviceId, profile, serialized = profile.cookies.serializeJar()) => {
    const operation = profile.writePromise.then(() => persistence.write(deviceId, serialized));
    profile.writePromise = operation.catch(() => {});
    return track(operation);
  };

  const flush = async (deviceId) => {
    const profile = profiles.get(deviceId);
    if (!profile || !profile.persist) return;
    if (profile.flushTimer !== null) {
      clearTimer(profile.flushTimer);
      profile.flushTimer = null;
    }
    profile.dirty = false;
    try {
      await queueWrite(deviceId, profile);
    } catch (error) {
      profile.dirty = true;
      throw error;
    }
  };

  const markDirty = (deviceId) => {
    const profile = profileFor(deviceId);
    profile.used = true;
    onMutation(deviceId);
    if (!profile.persist) return;
    profile.dirty = true;
    if (profile.flushTimer !== null) return;
    profile.flushTimer = setTimer(() => {
      profile.flushTimer = null;
      void flush(deviceId).catch(() => {});
    }, 500);
  };

  const clearRetentionTimer = (profile) => {
    if (profile.retentionTimer === null) return;
    clearTimer(profile.retentionTimer);
    profile.retentionTimer = null;
  };

  const clearExpired = async (deviceId, profile) => {
    clearRetentionTimer(profile);
    if (profile.flushTimer !== null) {
      clearTimer(profile.flushTimer);
      profile.flushTimer = null;
    }
    profile.dirty = false;
    await profile.writePromise;
    installCookies(profile, createCookies());
    profile.used = false;
    profile.idleSince = null;
    await persistence.remove(deviceId);
  };

  const scheduleRetention = (deviceId, profile) => {
    clearRetentionTimer(profile);
    if (profile.active || profile.idleSince === null || profile.retentionDays === null) return null;
    const remaining = profile.idleSince + profile.retentionDays * DAY - now();
    if (remaining <= 0) return track(clearExpired(deviceId, profile));
    profile.retentionTimer = setTimer(() => {
      profile.retentionTimer = null;
      const operation = scheduleRetention(deviceId, profile);
      if (operation) void operation.catch(() => {});
    }, Math.min(remaining, MAX_TIMER_DELAY));
    return null;
  };

  const configure = async (deviceId, prefs) => {
    if (typeof prefs?.persist !== 'boolean' || ![1, 7, 30, null].includes(prefs?.retentionDays)) {
      throw new Error('invalid browser profile preferences');
    }
    const profile = profileFor(deviceId);
    const wasPersisting = profile.persist;
    profile.persist = prefs.persist;
    profile.retentionDays = prefs.retentionDays;
    let warning = null;

    if (prefs.persist && !wasPersisting) {
      if (!profile.loaded && !profile.used) {
        profile.loaded = true;
        try {
          const serialized = await persistence.read(deviceId);
          if (serialized !== null) replaceJar(profile, serialized);
        } catch {
          installCookies(profile, createCookies());
          profile.used = false;
          await persistence.remove(deviceId);
          warning = 'profile-recovery-failed';
        }
      } else {
        profile.loaded = true;
        await queueWrite(deviceId, profile);
      }
    } else if (!prefs.persist && wasPersisting) {
      if (profile.flushTimer !== null) {
        clearTimer(profile.flushTimer);
        profile.flushTimer = null;
      }
      profile.dirty = false;
      await profile.writePromise;
      await persistence.remove(deviceId);
    }

    const retention = scheduleRetention(deviceId, profile);
    if (retention) await retention;
    return { persist: profile.persist, retentionDays: profile.retentionDays, warning };
  };

  const setActive = (deviceId, active) => {
    const profile = profiles.get(deviceId);
    if (!profile) return;
    if (active) {
      profile.active = true;
      profile.idleSince = null;
      clearRetentionTimer(profile);
      return;
    }
    if (profile.active || profile.idleSince === null) profile.idleSince = now();
    profile.active = false;
    const retention = scheduleRetention(deviceId, profile);
    if (retention) void retention.catch(() => {});
  };

  const attach = (deviceId, sessionCookies) => {
    const profile = profileFor(deviceId);
    if (!profile.cookies?._cookieJar || !sessionCookies?._cookieJar) {
      throw new Error('browser cookie profile unsupported');
    }
    profile.used = true;
    sessionCookies._cookieJar = profile.cookies._cookieJar;
    sessionCookies._pendingSyncCookies = [];
    profile.attached.add(sessionCookies);

    const originals = new Map();
    for (const name of MUTATION_METHODS) {
      const original = sessionCookies[name];
      originals.set(name, {
        hadOwn: Object.prototype.hasOwnProperty.call(sessionCookies, name),
        value: original,
      });
      sessionCookies[name] = (...args) => {
        const result = original.apply(sessionCookies, args);
        markDirty(deviceId);
        return result;
      };
    }

    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      profile.attached.delete(sessionCookies);
      for (const [name, original] of originals) {
        if (original.hadOwn) sessionCookies[name] = original.value;
        else delete sessionCookies[name];
      }
    };
  };

  const serialize = (deviceId) => {
    const profile = profiles.get(deviceId);
    if (!profile) return null;
    profile.used = true;
    return profile.cookies.serializeJar();
  };

  const clear = (deviceId, { url } = {}) => {
    const profile = profiles.get(deviceId);
    if (!profile) return { cleared: false };
    profile.used = true;
    if (!url) {
      replaceJar(profile, null);
      onMutation(deviceId);
      profile.dirty = false;
      if (profile.flushTimer !== null) {
        clearTimer(profile.flushTimer);
        profile.flushTimer = null;
      }
      if (profile.persist) {
        track(profile.writePromise.then(() => persistence.remove(deviceId)));
      }
      return { cleared: true };
    }

    const internalCookies = profile.cookies._cookieJar.getCookiesSync(url);
    if (!internalCookies.length) return { cleared: false };
    const matches = profile.cookies._convertToExternalCookies(internalCookies);
    for (let index = 0; index < matches.length; index++) {
      matches[index].expires = internalCookies[index].expires;
      matches[index].maxAge = internalCookies[index].maxAge;
      matches[index].sameSite = internalCookies[index].sameSite;
    }
    profile.cookies.deleteCookies(matches, [url]);
    markDirty(deviceId);
    return { cleared: true };
  };

  const remove = (deviceId) => {
    const profile = profiles.get(deviceId);
    if (!profile) return false;
    clearRetentionTimer(profile);
    if (profile.flushTimer !== null) clearTimer(profile.flushTimer);
    profiles.delete(deviceId);
    if (profile.persist) {
      track(profile.writePromise.then(() => persistence.remove(deviceId)));
    }
    return true;
  };
  const has = (deviceId) => profiles.has(deviceId);

  const close = async () => {
    const flushes = [];
    for (const [deviceId, profile] of profiles) {
      clearRetentionTimer(profile);
      if (profile.dirty) flushes.push(flush(deviceId));
      else if (profile.flushTimer !== null) {
        clearTimer(profile.flushTimer);
        profile.flushTimer = null;
      }
    }
    await Promise.all(flushes);
    await Promise.all([...pending]);
    await persistence.close();
  };

  return {
    attach, serialize, clear, remove, has, configure, setActive, flush, close,
  };
}

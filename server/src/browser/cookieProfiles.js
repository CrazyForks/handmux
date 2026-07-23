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
  let closing = false;

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
        operationPromise: Promise.resolve(),
        useVersion: 0,
        retentionEpoch: 0,
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

  const queueOperation = (profile, operation) => {
    const result = profile.operationPromise.then(operation);
    profile.operationPromise = result.catch(() => {});
    return track(result);
  };

  const queueWrite = (deviceId, profile, serialized = profile.cookies.serializeJar()) => (
    queueOperation(profile, () => persistence.write(deviceId, serialized))
  );

  const flush = async (deviceId) => {
    const profile = profiles.get(deviceId);
    if (!profile || !profile.persist) return;
    if (!profile.dirty) {
      await profile.operationPromise;
      return;
    }
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
    profile.useVersion += 1;
    onMutation(deviceId);
    if (!profile.persist) return;
    profile.dirty = true;
    if (closing || profile.flushTimer !== null) return;
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

  const clearExpired = async (deviceId, profile, expectedEpoch, expectedIdleSince) => {
    clearRetentionTimer(profile);
    if (profile.dirty) await flush(deviceId);
    else await profile.operationPromise;
    if (profile.active
      || profile.retentionEpoch !== expectedEpoch
      || profile.idleSince !== expectedIdleSince) return;
    installCookies(profile, createCookies());
    profile.used = false;
    profile.useVersion += 1;
    profile.idleSince = null;
    profile.dirty = false;
    await queueOperation(profile, () => persistence.remove(deviceId));
  };

  const scheduleRetention = (deviceId, profile) => {
    clearRetentionTimer(profile);
    if (closing || profile.active || profile.idleSince === null || profile.retentionDays === null) return null;
    const remaining = profile.idleSince + profile.retentionDays * DAY - now();
    if (remaining <= 0) {
      return track(clearExpired(
        deviceId,
        profile,
        profile.retentionEpoch,
        profile.idleSince,
      ));
    }
    profile.retentionTimer = setTimer(() => {
      profile.retentionTimer = null;
      const operation = scheduleRetention(deviceId, profile);
      if (operation) void operation.catch(() => {});
    }, Math.min(remaining, MAX_TIMER_DELAY));
    return null;
  };

  const saveCurrent = async (deviceId, profile) => {
    if (profile.flushTimer !== null) {
      clearTimer(profile.flushTimer);
      profile.flushTimer = null;
    }
    profile.dirty = false;
    await queueWrite(deviceId, profile);
  };

  const configureImpl = async (deviceId, prefs) => {
    if (typeof prefs?.persist !== 'boolean' || ![1, 7, 30, null].includes(prefs?.retentionDays)) {
      throw new Error('invalid browser profile preferences');
    }
    const profile = profileFor(deviceId);
    const wasPersisting = profile.persist;
    profile.retentionEpoch += 1;
    let warning = null;

    if (prefs.persist && !wasPersisting) {
      profile.persist = true;
      profile.retentionDays = prefs.retentionDays;
      if (!profile.loaded && !profile.used) {
        profile.loaded = true;
        const useVersion = profile.useVersion;
        try {
          const serialized = await persistence.read(deviceId);
          if (profile.used || profile.useVersion !== useVersion) {
            await saveCurrent(deviceId, profile);
          } else if (serialized !== null) {
            replaceJar(profile, serialized);
          }
        } catch {
          warning = 'profile-recovery-failed';
          await queueOperation(profile, () => persistence.remove(deviceId));
          if (profile.used || profile.useVersion !== useVersion) {
            await saveCurrent(deviceId, profile);
          } else {
            installCookies(profile, createCookies());
            profile.used = false;
            profile.useVersion += 1;
          }
        }
      } else {
        profile.loaded = true;
        await saveCurrent(deviceId, profile);
      }
    } else if (!prefs.persist && wasPersisting) {
      const wasDirty = profile.dirty;
      if (profile.flushTimer !== null) {
        clearTimer(profile.flushTimer);
        profile.flushTimer = null;
      }
      profile.dirty = false;
      try {
        await queueOperation(profile, () => persistence.remove(deviceId));
      } catch (error) {
        profile.dirty ||= wasDirty;
        throw error;
      }
      if (profile.flushTimer !== null) {
        clearTimer(profile.flushTimer);
        profile.flushTimer = null;
      }
      profile.dirty = false;
      profile.persist = false;
      profile.retentionDays = prefs.retentionDays;
    } else {
      profile.persist = prefs.persist;
      profile.retentionDays = prefs.retentionDays;
    }

    const retention = scheduleRetention(deviceId, profile);
    if (retention) await retention;
    return { persist: profile.persist, retentionDays: profile.retentionDays, warning };
  };

  const configure = (deviceId, prefs) => track(configureImpl(deviceId, prefs));

  const setActive = (deviceId, active) => {
    const profile = profiles.get(deviceId);
    if (!profile) return;
    profile.retentionEpoch += 1;
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
    profile.useVersion += 1;
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
    profile.useVersion += 1;
    return profile.cookies.serializeJar();
  };

  const clear = (deviceId, { url, hostname } = {}) => {
    const profile = profiles.get(deviceId);
    if (!profile) return { cleared: false };
    profile.used = true;
    profile.useVersion += 1;
    let targetHostname = hostname;
    if (!targetHostname && url) {
      try { targetHostname = new URL(url).hostname; } catch { return { cleared: false }; }
    }
    if (!targetHostname) {
      replaceJar(profile, null);
      onMutation(deviceId);
      profile.dirty = false;
      if (profile.flushTimer !== null) {
        clearTimer(profile.flushTimer);
        profile.flushTimer = null;
      }
      if (profile.persist) {
        return queueOperation(profile, () => persistence.remove(deviceId))
          .then(() => ({ cleared: true }));
      }
      return { cleared: true };
    }

    const normalizedHostname = targetHostname.toLowerCase();
    const internalCookies = profile.cookies._getAllCookiesSync().filter((cookie) => {
      const domain = cookie.domain?.replace(/^\./, '').toLowerCase();
      if (!domain) return false;
      if (cookie.hostOnly) return domain === normalizedHostname;
      return normalizedHostname === domain || normalizedHostname.endsWith(`.${domain}`);
    });
    if (!internalCookies.length) return { cleared: false };
    const matches = profile.cookies._convertToExternalCookies(internalCookies);
    for (let index = 0; index < matches.length; index++) {
      matches[index].expires = internalCookies[index].expires;
      matches[index].maxAge = internalCookies[index].maxAge;
      matches[index].sameSite = internalCookies[index].sameSite;
    }
    profile.cookies.deleteCookies(matches);
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
      queueOperation(profile, () => persistence.remove(deviceId));
    }
    return true;
  };
  const has = (deviceId) => profiles.has(deviceId);

  const close = async () => {
    closing = true;
    for (const profile of profiles.values()) clearRetentionTimer(profile);
    while (true) {
      const flushes = [];
      for (const [deviceId, profile] of profiles) {
        if (profile.dirty) flushes.push(flush(deviceId));
        else if (profile.flushTimer !== null) {
          clearTimer(profile.flushTimer);
          profile.flushTimer = null;
        }
      }
      await Promise.all(flushes);
      const operations = [...pending];
      if (!operations.length) break;
      await Promise.all(operations);
    }
    for (const profile of profiles.values()) clearRetentionTimer(profile);
    await persistence.close();
  };

  return {
    attach, serialize, clear, remove, has, configure, setActive, flush, close,
  };
}

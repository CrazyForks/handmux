const MUTATION_METHODS = ['setByServer', 'setByClient', 'setCookies', 'deleteCookies'];

export function createDeviceCookieProfiles({ createCookies, onMutation = () => {} }) {
  const profiles = new Map();

  const profileFor = (deviceId) => {
    let profile = profiles.get(deviceId);
    if (!profile) {
      profile = { cookies: createCookies(), attached: new Set() };
      profiles.set(deviceId, profile);
    }
    return profile;
  };

  const replaceJar = (profile, serialized) => {
    profile.cookies.setJar(serialized);
    for (const cookies of profile.attached) {
      cookies._cookieJar = profile.cookies._cookieJar;
      cookies._pendingSyncCookies = [];
    }
  };

  const attach = (deviceId, sessionCookies) => {
    const profile = profileFor(deviceId);
    if (!profile.cookies?._cookieJar || !sessionCookies?._cookieJar) {
      throw new Error('browser cookie profile unsupported');
    }
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
        onMutation(deviceId);
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

  const serialize = (deviceId) => profiles.get(deviceId)?.cookies.serializeJar() ?? null;

  const clear = (deviceId, { url } = {}) => {
    const profile = profiles.get(deviceId);
    if (!profile) return { cleared: false };
    if (!url) {
      replaceJar(profile, null);
      onMutation(deviceId);
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
    onMutation(deviceId);
    return { cleared: true };
  };

  const remove = (deviceId) => profiles.delete(deviceId);
  const has = (deviceId) => profiles.has(deviceId);

  return { attach, serialize, clear, remove, has };
}

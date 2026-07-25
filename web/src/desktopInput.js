export function isDesktopInputEnvironment({
  ua = '', platform = '', maxTouchPoints = 0, mobileHint = null,
  finePointer = false, hover = false,
} = {}) {
  const mobileOS = /Android|iPhone|iPad|iPod/i.test(ua)
    || (platform === 'MacIntel' && maxTouchPoints > 1)
    || mobileHint === true;
  const desktopOS = /Mac|Win|Linux/i.test(platform) || /Macintosh|Windows NT|X11; Linux/i.test(ua);
  return !mobileOS && desktopOS && finePointer && hover;
}

export function desktopInputEnvironment(win = window) {
  const nav = win.navigator;
  return isDesktopInputEnvironment({
    ua: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    mobileHint: nav.userAgentData?.mobile ?? null,
    finePointer: win.matchMedia?.('(pointer: fine)').matches === true,
    hover: win.matchMedia?.('(hover: hover)').matches === true,
  });
}

const KEYBOARD_MODE_KEY = 'tw_keyboard_mode';
const KEYBOARD_MODES = new Set(['auto', 'mobile', 'desktop']);

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

export function getKeyboardMode(storage = window.localStorage) {
  try {
    const mode = storage.getItem(KEYBOARD_MODE_KEY);
    return KEYBOARD_MODES.has(mode) ? mode : 'auto';
  } catch {
    return 'auto';
  }
}

export function setKeyboardMode(mode, storage = window.localStorage) {
  if (!KEYBOARD_MODES.has(mode)) return;
  try { storage.setItem(KEYBOARD_MODE_KEY, mode); } catch { /* storage unavailable */ }
}

export function keyboardModeUsesDesktop(mode, detectedDesktop) {
  if (mode === 'desktop') return true;
  if (mode === 'mobile') return false;
  return !!detectedDesktop;
}

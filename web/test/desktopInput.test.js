import { describe, expect, it } from 'vitest';
import {
  getKeyboardMode,
  isDesktopInputEnvironment,
  keyboardModeUsesDesktop,
  setKeyboardMode,
} from '../src/desktopInput.js';

const base = {
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  platform: 'MacIntel',
  maxTouchPoints: 0,
  mobileHint: false,
  finePointer: true,
  hover: true,
};

describe('isDesktopInputEnvironment', () => {
  it('accepts desktop Mac/Windows/Linux even when the viewport is narrow', () => {
    expect(isDesktopInputEnvironment(base)).toBe(true);
    expect(isDesktopInputEnvironment({ ...base, ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', platform: 'Win32' })).toBe(true);
    expect(isDesktopInputEnvironment({ ...base, ua: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' })).toBe(true);
  });

  it('keeps iPhone, Android, and iPadOS-on-Mac-UA on the mobile path', () => {
    expect(isDesktopInputEnvironment({ ...base, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', platform: 'iPhone' })).toBe(false);
    expect(isDesktopInputEnvironment({ ...base, ua: 'Mozilla/5.0 (Linux; Android 15)', platform: 'Linux armv8l' })).toBe(false);
    expect(isDesktopInputEnvironment({ ...base, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(false);
  });

  it('fails closed without a fine pointer and hover', () => {
    expect(isDesktopInputEnvironment({ ...base, finePointer: false })).toBe(false);
    expect(isDesktopInputEnvironment({ ...base, hover: false })).toBe(false);
  });
});

describe('keyboard mode preference', () => {
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    };
  };

  it('defaults invalid or missing preferences to auto and persists valid choices', () => {
    const store = storage();
    expect(getKeyboardMode(store)).toBe('auto');
    store.setItem('tw_keyboard_mode', 'other');
    expect(getKeyboardMode(store)).toBe('auto');
    setKeyboardMode('mobile', store);
    expect(getKeyboardMode(store)).toBe('mobile');
  });

  it('lets mobile and desktop override detection while auto keeps detection', () => {
    expect(keyboardModeUsesDesktop('mobile', true)).toBe(false);
    expect(keyboardModeUsesDesktop('desktop', false)).toBe(true);
    expect(keyboardModeUsesDesktop('auto', true)).toBe(true);
    expect(keyboardModeUsesDesktop('auto', false)).toBe(false);
  });
});

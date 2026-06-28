import { describe, it, expect } from 'vitest';
import { detectLang, translate, AVAILABLE } from '../src/i18n/index.js';

const LOCALES = { en: {}, zh: {} };

describe('detectLang', () => {
  it('prefers a saved override that we support', () => {
    expect(detectLang('zh', ['en-US'], LOCALES)).toBe('zh');
  });
  it('ignores a saved override we do not support', () => {
    expect(detectLang('fr', ['zh-CN', 'en'], LOCALES)).toBe('zh');
  });
  it('falls back to the first supported browser language', () => {
    expect(detectLang(null, ['fr-FR', 'zh-CN', 'en'], LOCALES)).toBe('zh');
  });
  it('defaults to English when nothing matches', () => {
    expect(detectLang(null, ['fr-FR', 'de'], LOCALES)).toBe('en');
    expect(detectLang(null, [], LOCALES)).toBe('en');
    expect(detectLang(null, null, LOCALES)).toBe('en');
  });
});

describe('translate', () => {
  const zh = { 'a.b': '你好', 'greet': '你好 {name}' };
  const en = { 'a.b': 'Hello', 'greet': 'Hello {name}', 'only.en': 'Only EN' };

  it('uses the current dict when present', () => {
    expect(translate(zh, en, 'a.b')).toBe('你好');
  });
  it('falls back to English when the key is missing in the current dict', () => {
    expect(translate(zh, en, 'only.en')).toBe('Only EN');
  });
  it('falls back to the key itself when nowhere', () => {
    expect(translate(zh, en, 'nope.nope')).toBe('nope.nope');
  });
  it('interpolates {vars} and leaves unknown vars marked', () => {
    expect(translate(zh, en, 'greet', { name: '世界' })).toBe('你好 世界');
    expect(translate(en, en, 'greet', {})).toBe('Hello {name}');
  });
});

describe('AVAILABLE', () => {
  it('lists at least English and Chinese with code+label', () => {
    const codes = AVAILABLE.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('zh');
    AVAILABLE.forEach((l) => { expect(l.label).toBeTruthy(); });
  });
});

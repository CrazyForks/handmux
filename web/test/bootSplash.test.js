import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const bootScript = [...indexHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((script) => script.includes('window.__hideBootSplash'));

describe('boot splash', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete window.__bootStart;
    delete window.__hideBootSplash;
    document.body.innerHTML = '';
  });

  it('stays visible until the app reports that it has painted', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="boot-splash"></div><div id="root"></div>';

    new Function('window', 'document', 'setTimeout', bootScript)(
      window,
      document,
      setTimeout,
    );

    vi.advanceTimersByTime(30_000);
    expect(document.getElementById('boot-splash')).not.toBeNull();

    window.__hideBootSplash();
    vi.advanceTimersByTime(1_200);
    expect(document.getElementById('boot-splash')).toBeNull();
  });
});

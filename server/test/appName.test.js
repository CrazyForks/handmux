import { describe, it, expect } from 'vitest';
import { applyAppName, applyManifestName } from '../src/appName.js';

const HTML = `<!doctype html><html><head>
<title>tmux web</title>
<meta name="apple-mobile-web-app-title" content="tmux" />
</head><body></body></html>`;

describe('applyAppName', () => {
  it('rewrites the tab title and the iOS home-screen label', () => {
    const out = applyAppName(HTML, 'My Box');
    expect(out).toContain('<title>My Box</title>');
    expect(out).toContain('<meta name="apple-mobile-web-app-title" content="My Box" />');
  });
  it('escapes HTML-significant chars so a hostile name can\'t break out', () => {
    const out = applyAppName(HTML, '<x>"&');
    expect(out).toContain('<title>&lt;x&gt;&quot;&amp;</title>');
    expect(out).not.toContain('<x>');
  });
  it('is a no-op without a name, and leaves other markup untouched', () => {
    expect(applyAppName(HTML, null)).toBe(HTML);
    expect(applyAppName(HTML, '')).toBe(HTML);
    expect(applyAppName(HTML, 'X')).toContain('<!doctype html>');
  });
});

describe('applyManifestName', () => {
  it('overrides name + short_name, preserving the rest', () => {
    const m = { name: 'tmux web', short_name: 'tmux', display: 'standalone', icons: [1] };
    const out = applyManifestName(m, 'My Box');
    expect(out.name).toBe('My Box');
    expect(out.short_name).toBe('My Box');
    expect(out.display).toBe('standalone');
    expect(out.icons).toEqual([1]);
  });
  it('is a no-op without a name', () => {
    const m = { name: 'tmux web' };
    expect(applyManifestName(m, null)).toBe(m);
  });
});

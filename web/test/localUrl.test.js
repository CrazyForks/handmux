import { describe, it, expect } from 'vitest';
import { findLocalUrls } from '../src/localUrl.js';
import { findDocLinks } from '../src/docPath.js';

describe('findLocalUrls', () => {
  const one = (line) => { const r = findLocalUrls(line); expect(r).toHaveLength(1); return r[0]; };

  it('matches localhost with port and path', () => {
    const u = one('running at http://localhost:3000/foo/bar');
    expect(u).toMatchObject({ port: 3000, path: '/foo/bar', raw: 'http://localhost:3000/foo/bar' });
  });

  it('matches 127.0.0.1 / 0.0.0.0 / [::1]', () => {
    expect(one('http://127.0.0.1:5173/').port).toBe(5173);
    expect(one('http://0.0.0.0:8080/app').path).toBe('/app');
    expect(one('http://[::1]:4000/x').port).toBe(4000);
  });

  it('defaults the port to the scheme when omitted', () => {
    expect(one('http://localhost/').port).toBe(80);
    expect(one('https://localhost/secure').port).toBe(443);
  });

  it('defaults the path to "/" when absent', () => {
    expect(one('open http://localhost:3000').path).toBe('/');
  });

  it('keeps query and hash in the path', () => {
    expect(one('http://localhost:3000/admin?tab=1#top').path).toBe('/admin?tab=1#top');
  });

  it('strips a trailing sentence dot but keeps the path', () => {
    const u = one('see http://localhost:3000/foo. done');
    expect(u.path).toBe('/foo');
    expect(u.raw).toBe('http://localhost:3000/foo');
  });

  it('ends the path at a delimiter (Chinese prose / brackets)', () => {
    expect(one('访问 http://localhost:5173/页面，然后').path).toBe('/页面');
    expect(one('(http://localhost:8080/a)').path).toBe('/a');
  });

  it('rejects a non-loopback host', () => {
    expect(findLocalUrls('http://example.com:3000/foo')).toHaveLength(0);
    expect(findLocalUrls('http://192.168.1.5:3000/foo')).toHaveLength(0);
  });

  it('finds several on one line', () => {
    const r = findLocalUrls('http://localhost:3000/ and http://127.0.0.1:9000/x');
    expect(r.map((u) => u.port)).toEqual([3000, 9000]);
  });

  it('rejects an out-of-range port', () => {
    expect(findLocalUrls('http://localhost:99999/foo')).toHaveLength(0);
  });
});

describe('local URL vs doc-path do not collide', () => {
  it('a localhost URL ending in .html is not also a doc-path (: is a doc delimiter)', () => {
    const line = 'preview http://localhost:3000/foo.html';
    const urls = findLocalUrls(line);
    expect(urls).toHaveLength(1);
    expect(urls[0].path).toBe('/foo.html');
    // The raw findDocLinks WOULD spuriously see `3000/foo.html`; docDecorations drops it because it
    // overlaps the URL span. Assert the overlap so the drop rule in docDecorations stays justified.
    const doc = findDocLinks(line).find((d) => d.start < urls[0].end && d.end > urls[0].start);
    expect(doc).toBeTruthy();
  });

  it('a real doc path alongside a URL still resolves independently', () => {
    const line = 'edit docs/plan.md then open http://localhost:3000/x';
    expect(findLocalUrls(line)).toHaveLength(1);
    const docs = findDocLinks(line);
    expect(docs.some((d) => d.path === 'docs/plan.md')).toBe(true);
  });
});

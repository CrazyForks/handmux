// server/test/docPath.test.js
import { describe, it, expect } from 'vitest';
import { safeUploadName, hasHiddenSegment, isUnder, docTypeFor, imageTypeFor } from '../src/docPath.js';

describe('safeUploadName', () => {
  it('keeps a plain filename', () => {
    expect(safeUploadName('photo.png')).toBe('photo.png');
  });
  it('strips any directory part to the basename', () => {
    expect(safeUploadName('/etc/passwd')).toBe('passwd');
    expect(safeUploadName('a/b/c.txt')).toBe('c.txt');
    expect(safeUploadName('a\\b\\c.txt')).toBe('c.txt');
  });
  it('rejects empty, dot, dotdot, and dotfiles', () => {
    expect(safeUploadName('')).toBeNull();
    expect(safeUploadName('.')).toBeNull();
    expect(safeUploadName('..')).toBeNull();
    expect(safeUploadName('.bashrc')).toBeNull();
    expect(safeUploadName(undefined)).toBeNull();
  });
});

describe('hasHiddenSegment', () => {
  it('false for the home root itself and plain subdirs', () => {
    expect(hasHiddenSegment('/home/u', '/home/u')).toBe(false);
    expect(hasHiddenSegment('/home/u/projects/app', '/home/u')).toBe(false);
  });
  it('true when any segment below home starts with a dot', () => {
    expect(hasHiddenSegment('/home/u/.ssh', '/home/u')).toBe(true);
    expect(hasHiddenSegment('/home/u/.config/app', '/home/u')).toBe(true);
    expect(hasHiddenSegment('/home/u/a/.hidden/b', '/home/u')).toBe(true);
  });
});

// regression: existing helpers still exported/working
describe('existing docPath helpers', () => {
  it('isUnder guards the sibling-prefix trap', () => {
    expect(isUnder('/home/ab', '/home/a')).toBe(false);
    expect(isUnder('/home/a/x', '/home/a')).toBe(true);
  });
  it('docTypeFor maps md/html', () => {
    expect(docTypeFor('x.md')).toBe('markdown');
    expect(docTypeFor('x.png')).toBeNull();
  });
  it('docTypeFor maps txt/log/sh to text', () => {
    expect(docTypeFor('x.txt')).toBe('text');
    expect(docTypeFor('x.LOG')).toBe('text');
    expect(docTypeFor('deploy.sh')).toBe('text');
  });
});

describe('imageTypeFor', () => {
  it('matches common image extensions case-insensitively', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'b.gif', 'c.webp', 'd.svg', 'e.bmp', 'f.ico', 'g.avif', 'h.JFIF', 'i.apng']) {
      expect(imageTypeFor(n)).toBe('image');
    }
  });
  it('returns null for non-images and extensionless names', () => {
    expect(imageTypeFor('x.md')).toBeNull();
    expect(imageTypeFor('x.txt')).toBeNull();
    expect(imageTypeFor('pnglike')).toBeNull();
    expect(imageTypeFor('')).toBeNull();
  });
});

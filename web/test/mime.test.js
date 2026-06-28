// web/test/mime.test.js
import { describe, it, expect } from 'vitest';
import { mimeFromName, isImageName } from '../src/mime.js';

describe('mimeFromName', () => {
  it('maps common image extensions (case-insensitive)', () => {
    expect(mimeFromName('photo.jpg')).toBe('image/jpeg');
    expect(mimeFromName('PHOTO.JPEG')).toBe('image/jpeg');
    expect(mimeFromName('shot.PNG')).toBe('image/png');
    expect(mimeFromName('pic.heic')).toBe('image/heic');
    expect(mimeFromName('anim.webp')).toBe('image/webp');
  });
  it('maps docs and text', () => {
    expect(mimeFromName('a.pdf')).toBe('application/pdf');
    expect(mimeFromName('notes.md')).toBe('text/markdown');
    expect(mimeFromName('report.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
  it('returns empty for unknown or missing extension (caller keeps server type)', () => {
    expect(mimeFromName('archive.xyz')).toBe('');
    expect(mimeFromName('noext')).toBe('');
    expect(mimeFromName('')).toBe('');
    expect(mimeFromName('.dotfile')).toBe(''); // leading dot → extension "dotfile" unknown
  });
});

describe('isImageName', () => {
  it('is true for image extensions, false for docs/other/none', () => {
    for (const n of ['a.png', 'b.JPG', 'c.gif', 'd.webp', 'e.svg', 'f.bmp', 'g.ico', 'h.avif']) {
      expect(isImageName(n)).toBe(true);
    }
    expect(isImageName('x.md')).toBe(false);
    expect(isImageName('x.txt')).toBe(false);
    expect(isImageName('noext')).toBe(false);
  });
});

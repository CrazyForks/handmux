import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const styles = readFileSync(`${process.cwd()}/src/styles.css`, 'utf8');

describe('desktop scrollbar styles', () => {
  it('uses one custom scrollbar skin only for precise pointing devices', () => {
    expect(styles).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)\s*\{[\s\S]*scrollbar-color:\s*var\(--scroll-thumb\)\s+transparent/,
    );
    expect(styles).toMatch(/\*::\-webkit-scrollbar\s*\{[^}]*width:\s*10px[^}]*height:\s*10px/);
    expect(styles).toMatch(
      /\*::\-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*var\(--scroll-thumb\)[^}]*background-clip:\s*padding-box/,
    );
    expect(styles).toMatch(/\*::\-webkit-scrollbar-thumb:active\s*\{[^}]*var\(--scroll-thumb-active\)/);
  });

  it('keeps navigation strips scrollable without showing a scrollbar', () => {
    expect(styles).toMatch(
      /\.file-tabs-scroll,\s*\.git-tabs-scroll\s*\{[^}]*scrollbar-width:\s*none/,
    );
    expect(styles).toMatch(
      /\.file-tabs-scroll::\-webkit-scrollbar,\s*\.git-tabs-scroll::\-webkit-scrollbar\s*\{[^}]*display:\s*none/,
    );
  });
});

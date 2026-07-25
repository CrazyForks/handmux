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

  it('shows an arrowless horizontal scrollbar only when the terminal overflows', () => {
    expect(styles).toMatch(/\.terminal\s*\{[^}]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\*::\-webkit-scrollbar:horizontal\s*\{[^}]*height:\s*0/);
    expect(styles).toMatch(
      /\.terminal::\-webkit-scrollbar:horizontal\s*\{[^}]*height:\s*10px/,
    );
    expect(styles).toMatch(
      /\.terminal::\-webkit-scrollbar-button\s*\{[^}]*display:\s*none[^}]*width:\s*0[^}]*height:\s*0/,
    );
    expect(styles).not.toMatch(/overflow-x:\s*scroll/);
  });

  it('uses one intrinsic-width stack for the live grid and its history preview', () => {
    expect(styles).toMatch(/\.terminal__stack\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%/);
    expect(styles).toMatch(
      /\.terminal--stream-exact \.terminal__stack\s*\{[^}]*align-items:\s*stretch/,
    );
  });
});

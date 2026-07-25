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

  it('shows the same reserved horizontal scrollbar on desktop and touch devices', () => {
    expect(styles).toMatch(
      /\*::\-webkit-scrollbar:horizontal\s*\{[^}]*height:\s*10px/,
    );
    expect(styles).toMatch(
      /\.windowbar-scroll,[\s\S]*\.es-diff,[\s\S]*\.cc-quick\s*\{[^}]*overflow-x:\s*scroll/,
    );
    expect(styles).not.toMatch(/scrollbar-width:\s*none/);
    expect(styles).not.toMatch(/::\-webkit-scrollbar(?::horizontal)?\s*\{[^}]*display:\s*none/);
    expect(styles).not.toMatch(/::\-webkit-scrollbar:horizontal\s*\{[^}]*height:\s*0/);
  });
});

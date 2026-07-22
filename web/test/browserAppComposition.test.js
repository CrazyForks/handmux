import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
const styles = readFileSync(path.resolve(process.cwd(), 'src/styles.css'), 'utf8');

describe('built-in browser App composition', () => {
  it('mounts one global browser model and its sheet', () => {
    expect(source).toContain("import BrowserSheet from './components/BrowserSheet.jsx'");
    expect(source).toContain("import { useBrowser } from './hooks/useBrowser.js'");
    expect(source).toMatch(/const browser = useBrowser\(\{ enabled: !needToken \}\)/);
    expect(source).toContain('<BrowserSheet browser={browser} />');
  });

  it('renders the browser toolbar entry unconditionally', () => {
    expect(source).toMatch(/className="topbar-icon browser-entry"[^>]+onClick=\{\(\) => browser\.setOpen\(true\)\}/);
    expect(source).not.toMatch(/\{shownPreview && \(\s*<button className="topbar-icon preview-live"/);
  });

  it('routes confirmed terminal web links into the built-in browser', () => {
    expect(source).toContain('await browser.openUrl(p.raw, { signal: controller.signal })');
    expect(source).not.toContain('if (!p || localUrlOpeningRef.current) return');
    expect(source).toMatch(/const p = localUrlPrompt;[\s\S]*?localUrlAbortRef\.current\?\.abort\(\);[\s\S]*?const controller = new AbortController\(\)/);
    expect(source).toContain('allowRepeat={true}');
    expect(source).not.toContain('startUrlPreview({');
    expect(source).not.toContain('disabled={!dynamicEnabled}');
  });

  it('keeps the transparent loading layer interactive so it blocks the page below', () => {
    const rule = styles.match(/\.browser-page-loading\s*\{([^}]+)\}/)?.[1] || '';
    expect(rule).toContain('pointer-events: auto');
    expect(rule).toContain('touch-action: none');
  });
});

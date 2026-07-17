// web/test/chatGate.test.js
import { describe, it, expect } from 'vitest';
import { fallbackGate } from '../src/chatGate.js';

// The transcript-based gate was removed: a pending prompt's options aren't in the .jsonl until answered, so
// options are now scraped from the pane (see server/src/pendingPrompt.js + PromptGate). chatGate only holds
// the generic 允许/拒绝 fallback used when the menu can't be parsed.
describe('fallbackGate', () => {
  it('returns 允许/拒绝 driving Enter / Escape', () => {
    const g = fallbackGate();
    expect(g.options.map((o) => o.label)).toEqual(['允许', '拒绝']);
    expect(g.options[0].keys).toEqual(['Enter']);
    expect(g.options[1].keys).toEqual(['Escape']);
  });
});

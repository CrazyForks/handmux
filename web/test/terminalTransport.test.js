import { describe, expect, it } from 'vitest';
import {
  getTerminalTransport,
  setTerminalTransport,
  terminalStreamEnabled,
} from '../src/terminalTransport.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('terminal transport preference', () => {
  it('defaults to live and persists the snapshot fallback', () => {
    const store = storage();
    expect(getTerminalTransport(store)).toBe('live');
    setTerminalTransport('snapshot', store);
    expect(getTerminalTransport(store)).toBe('snapshot');
    setTerminalTransport('unknown', store);
    expect(getTerminalTransport(store)).toBe('live');
  });

  it('lets an explicit query override the saved browser preference', () => {
    expect(terminalStreamEnabled({ search: '' }, 'live')).toBe(true);
    expect(terminalStreamEnabled({ search: '' }, 'snapshot')).toBe(false);
    expect(terminalStreamEnabled({ search: '?terminalStream=0' }, 'live')).toBe(false);
    expect(terminalStreamEnabled({ search: '?terminalStream=1' }, 'snapshot')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { moveTarget } from '../src/windowOrder.js';

const wins = [{ id: '@1' }, { id: '@2' }, { id: '@3' }];

describe('moveTarget', () => {
  it('moving left returns the previous window', () => {
    expect(moveTarget(wins, '@2', 'left')).toEqual({ id: '@1' });
  });
  it('moving right returns the next window', () => {
    expect(moveTarget(wins, '@2', 'right')).toEqual({ id: '@3' });
  });
  it('returns null at the left edge', () => {
    expect(moveTarget(wins, '@1', 'left')).toBeNull();
  });
  it('returns null at the right edge', () => {
    expect(moveTarget(wins, '@3', 'right')).toBeNull();
  });
  it('returns null when the id is not in the list', () => {
    expect(moveTarget(wins, '@9', 'left')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { parseTmuxFields, tmuxFormat } from '../src/tmux/format.js';

describe('tmux q format fields', () => {
  it('builds an unambiguous q-escaped pipe format', () => {
    expect(tmuxFormat(['session_id', 'session_name', '@handmux_session_id']))
      .toBe('#{q:session_id}|#{q:session_name}|#{q:@handmux_session_id}');
  });

  it('decodes escaped pipes, backslashes, spaces, and empty fields', () => {
    expect(parseTmuxFields('a\\|b|a\\\\b||two\\ words', 4, 'probe'))
      .toEqual(['a|b', 'a\\b', '', 'two words']);
  });

  it.each([
    ['a\\', 'dangling escape'],
    ['a\\xb', 'unsupported escape'],
    ['a|b', 'expected 3 fields'],
  ])('fails closed for malformed q output: %s', (line, message) => {
    expect(() => parseTmuxFields(line, 3, 'probe')).toThrow(message);
  });
});

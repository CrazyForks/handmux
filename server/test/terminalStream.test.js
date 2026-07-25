import { describe, expect, it } from 'vitest';
import { decodeControlData } from '../src/terminalStream.js';

describe('terminal control data decoder', () => {
  it('decodes octal escapes without corrupting raw UTF-8 bytes', () => {
    const input = Buffer.concat([
      Buffer.from('中文', 'utf8'),
      Buffer.from('\\033[2K'),
    ]);
    expect(decodeControlData(input)).toEqual(Buffer.concat([
      Buffer.from('中文', 'utf8'),
      Buffer.from([0x1b]),
      Buffer.from('[2K'),
    ]));
  });

  it('preserves a literal backslash that is not an octal escape', () => {
    expect(decodeControlData(Buffer.from('a\\\\b'))).toEqual(Buffer.from('a\\b'));
  });
});

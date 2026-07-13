// Guards the two shape definitions that are hand-mirrored across the web↔server boundary. The client
// copies exist for UX only (the server enforces), but nothing at build time keeps them in lockstep, so a
// server-side edit could silently desync the phone's `accept` hint / tappable-path detector. These tests
// import BOTH sides and fail loudly the moment they drift — turning a silent bug into a red CI run.
import { describe, it, expect } from 'vitest';
import { UPLOAD_EXTS } from '../src/uploadTypes.js';
import { DOC_LINK_EXTS, IMAGE_LINK_EXTS } from '../src/docPath.js';
import { DEFAULT_UPLOAD_EXTS } from '../../server/src/uploadTypes.js';
import { EXT as SERVER_DOC_EXT, IMG_EXT as SERVER_IMG_EXT } from '../../server/src/docPath.js';

const sorted = (xs) => [...xs].map((s) => s.toLowerCase()).sort();

describe('shared types parity (web mirrors server)', () => {
  it('upload allow-list matches the server default set exactly', () => {
    expect(sorted(UPLOAD_EXTS)).toEqual(sorted(DEFAULT_UPLOAD_EXTS));
  });

  it('openable image link extensions match the server imageTypeFor set', () => {
    expect(sorted(IMAGE_LINK_EXTS)).toEqual(sorted(SERVER_IMG_EXT));
  });

  it('openable doc link extensions match the server renderable-doc extensions', () => {
    // Server keys are dotted ('.md'); the web list is bare ('md').
    const serverDocExts = Object.keys(SERVER_DOC_EXT).map((k) => k.replace(/^\./, ''));
    expect(sorted(DOC_LINK_EXTS)).toEqual(sorted(serverDocExts));
  });
});

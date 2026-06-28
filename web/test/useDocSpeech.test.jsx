import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDocSpeech } from '../src/voice/useDocSpeech.js';

let spoken; // utterances handed to speak(), in order
let mock;

beforeEach(() => {
  spoken = [];
  mock = {
    speak: vi.fn((u) => spoken.push(u)),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: vi.fn(() => [{ lang: 'zh-CN', name: 'Tingting' }, { lang: 'en-US', name: 'Alex' }]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  window.speechSynthesis = mock;
  global.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  localStorage.clear();
});
afterEach(() => { delete window.speechSynthesis; });

describe('useDocSpeech', () => {
  it('plays the first sentence with the zh voice and reports state', () => {
    const { result } = renderHook(() => useDocSpeech());
    act(() => result.current.play(['一句。', '两句。', '三句。']));
    expect(mock.speak).toHaveBeenCalledTimes(1);
    expect(spoken[0].text).toBe('一句。');
    expect(spoken[0].lang).toBe('zh-CN');
    expect(result.current.idx).toBe(0);
    expect(result.current.playing).toBe(true);
  });

  it('advances to the next sentence when an utterance ends', () => {
    const { result } = renderHook(() => useDocSpeech());
    act(() => result.current.play(['一。', '二。']));
    act(() => spoken[0].onend());
    expect(spoken[1].text).toBe('二。');
    expect(result.current.idx).toBe(1);
  });

  it('stops and resets after the last sentence', () => {
    const { result } = renderHook(() => useDocSpeech());
    act(() => result.current.play(['只此一句。']));
    act(() => spoken[0].onend());
    expect(result.current.playing).toBe(false);
    expect(result.current.idx).toBe(-1);
    expect(mock.cancel).toHaveBeenCalled();
  });

  it('stop() cancels synthesis and resets', () => {
    const { result } = renderHook(() => useDocSpeech());
    act(() => result.current.play(['一。', '二。']));
    act(() => result.current.stop());
    expect(mock.cancel).toHaveBeenCalled();
    expect(result.current.playing).toBe(false);
    expect(result.current.idx).toBe(-1);
  });

  it('cycles and persists the rate, and speaks at the chosen rate', () => {
    const { result } = renderHook(() => useDocSpeech());
    expect(result.current.rate).toBe(1);
    act(() => result.current.cycleRate());
    expect(result.current.rate).toBe(1.25);
    expect(localStorage.getItem('tw_doc_rate')).toBe('1.25');

    act(() => result.current.play(['一。']));
    expect(spoken[spoken.length - 1].rate).toBe(1.25);
  });

  it('reads the persisted rate on init', () => {
    localStorage.setItem('tw_doc_rate', '1.5');
    const { result } = renderHook(() => useDocSpeech());
    expect(result.current.rate).toBe(1.5);
  });
});

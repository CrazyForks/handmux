import { describe, expect, it, vi } from 'vitest';
import {
  classifyConnectionSample,
  createConnectionTelemetry,
  formatReceiveRate,
  payloadBytes,
} from '../src/connectionTelemetry.js';

describe('connection telemetry', () => {
  it('classifies application RTT without treating zero traffic as a bad connection', () => {
    expect(classifyConnectionSample({ ok: true, rttMs: 120 })).toBe('good');
    expect(classifyConnectionSample({ ok: true, rttMs: 700 })).toBe('degraded');
    expect(classifyConnectionSample({ ok: true, rttMs: 1800 })).toBe('poor');
    expect(classifyConnectionSample({ ok: false })).toBe('poor');
  });

  it('formats receive throughput compactly', () => {
    expect(formatReceiveRate(0)).toBe('0 B/s');
    expect(formatReceiveRate(1536)).toBe('1.5 KB/s');
    expect(formatReceiveRate(12 * 1024)).toBe('12 KB/s');
    expect(payloadBytes({ ansi: '中文' })).toBeGreaterThan(10);
  });

  it('reports the actual fallback mode and dampens quality flapping', () => {
    let now = 0;
    const updates = [];
    const telemetry = createConnectionTelemetry({
      mode: 'live',
      now: () => now,
      onChange: (value) => updates.push(value),
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
    });
    telemetry.sample({ ok: true, rttMs: 100 });
    expect(telemetry.getSnapshot().quality).toBe('good');

    telemetry.sample({ ok: false, rttMs: 2000 });
    expect(telemetry.getSnapshot().quality).toBe('good');
    now = 15000;
    telemetry.sample({ ok: false, rttMs: 2000 });
    expect(telemetry.getSnapshot().quality).toBe('poor');

    telemetry.setMode('snapshot', { fallback: true });
    expect(telemetry.getSnapshot()).toMatchObject({ mode: 'snapshot', quality: 'degraded' });
    expect(updates.at(-1).mode).toBe('snapshot');
    telemetry.destroy();
  });

  it('starts a first failed sample as unstable instead of declaring a poor connection immediately', () => {
    const telemetry = createConnectionTelemetry({
      mode: 'live',
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
    });
    telemetry.sample({ ok: false });
    expect(telemetry.getSnapshot().quality).toBe('degraded');
    telemetry.destroy();
  });

  it('calculates a three-second rolling receive rate', () => {
    let now = 1000;
    const telemetry = createConnectionTelemetry({
      mode: 'live',
      now: () => now,
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
    });
    telemetry.traffic(3072);
    expect(telemetry.getSnapshot().bytesPerSecond).toBe(1024);
    now = 5000;
    expect(telemetry.getSnapshot().bytesPerSecond).toBe(0);
    telemetry.destroy();
  });

  it('recovers from an unstable connection after thirty seconds of good samples', () => {
    let now = 0;
    const telemetry = createConnectionTelemetry({
      mode: 'snapshot',
      now: () => now,
      setIntervalFn: vi.fn(() => 1),
      clearIntervalFn: vi.fn(),
    });
    telemetry.status('error');
    telemetry.sample({ ok: true, rttMs: 100 });
    now = 29999;
    telemetry.sample({ ok: true, rttMs: 100 });
    expect(telemetry.getSnapshot().quality).toBe('degraded');
    now = 30000;
    telemetry.sample({ ok: true, rttMs: 100 });
    expect(telemetry.getSnapshot().quality).toBe('good');
    telemetry.destroy();
  });
});

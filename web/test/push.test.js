import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tw_notify', '1');
  localStorage.setItem('tw_bound', JSON.stringify(['proj-a', 'proj-b']));
  localStorage.setItem('tw_token', 'tok');
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  global.navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ endpoint: 'E' }) } }) };
  global.window.PushManager = function () {};
  global.window.Notification = function () {};
});

afterEach(() => { delete global.navigator.serviceWorker; });

describe('reportBound', () => {
  it('POSTs the current bound set with the subscription endpoint', async () => {
    const { reportBound } = await import('../src/push.js');
    await reportBound();
    const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/api/push/bound'));
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body)).toEqual({ endpoint: 'E', boundSessions: ['proj-a', 'proj-b'] });
  });

  it('no-ops when notifications are disabled', async () => {
    localStorage.setItem('tw_notify', '0');
    vi.resetModules();
    const { reportBound } = await import('../src/push.js');
    await reportBound();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('no-ops when there is no push subscription', async () => {
    global.navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => null } }) };
    const { reportBound } = await import('../src/push.js');
    await reportBound();
    const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/api/push/bound'));
    expect(call).toBeUndefined();
  });
});

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

describe('notification inbox failures', () => {
  const response = (ok, body = {}, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });

  it('rejects a failed inbox load instead of turning it into an empty list', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('/api/push/key')
      ? response(true, { pushKey: 'K' })
      : response(false, {}, 503));
    const { getNotifications } = await import('../src/push.js');
    await expect(getNotifications()).rejects.toThrow();
  });

  it('rejects an unauthorized key lookup so App can return to the token prompt', async () => {
    global.fetch = vi.fn(async () => response(false, {}, 401));
    const { getNotifications } = await import('../src/push.js');
    const { UnauthorizedError } = await import('../src/api.js');
    await expect(getNotifications()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('keeps the Settings device-key lookup best-effort on the same auth failure', async () => {
    global.fetch = vi.fn(async () => response(false, {}, 401));
    const { getScriptPushKey } = await import('../src/push.js');
    await expect(getScriptPushKey()).resolves.toBeNull();
  });

  it('rejects a failed delete instead of reporting success to the optimistic UI', async () => {
    global.fetch = vi.fn(async (url) => String(url).includes('/api/push/key')
      ? response(true, { pushKey: 'K' })
      : response(false, {}, 503));
    const { deleteNotification } = await import('../src/push.js');
    await expect(deleteNotification('n1')).rejects.toThrow();
  });
});

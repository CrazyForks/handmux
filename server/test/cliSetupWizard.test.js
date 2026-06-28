import { describe, it, expect } from 'vitest';
import { cfConfigYaml, parseTunnelCreate, findTunnelId, configFromAnswers, mergeConfig } from '../src/cli/setupWizard.js';

describe('cfConfigYaml', () => {
  it('renders an ingress config pointing at the local port', () => {
    expect(cfConfigYaml({ tunnelName: 'handmux', credentialsFile: '/h/.cloudflared/u.json', hostname: 'h.x.com', port: 19999 }))
      .toBe([
        'tunnel: handmux',
        'credentials-file: /h/.cloudflared/u.json',
        'ingress:',
        '  - hostname: h.x.com',
        '    service: http://localhost:19999',
        '  - service: http_status:404',
        '',
      ].join('\n'));
  });
});

describe('parseTunnelCreate', () => {
  it('pulls the UUID and credentials path out of cloudflared output', () => {
    const out = [
      'Tunnel credentials written to /h/.cloudflared/abc-123.json.',
      'Created tunnel handmux with id abc-123',
    ].join('\n');
    expect(parseTunnelCreate(out)).toEqual({ id: 'abc-123', credentialsFile: '/h/.cloudflared/abc-123.json' });
  });
  it('returns nulls when the output does not match', () => {
    expect(parseTunnelCreate('boom')).toEqual({ id: null, credentialsFile: null });
  });
});

describe('findTunnelId', () => {
  const list = JSON.stringify([
    { id: '03233a8d-1', name: 'handmux', connections: null },
    { id: '1572dd00-2', name: 'handmux2', connections: null },
  ]);
  it('returns the UUID of an existing tunnel by name (so setup reuses, not re-creates)', () => {
    expect(findTunnelId(list, 'handmux2')).toBe('1572dd00-2');
  });
  it('returns null when the name is not present', () => {
    expect(findTunnelId(list, 'nope')).toBeNull();
  });
  it('tolerates empty / non-JSON / non-array output', () => {
    expect(findTunnelId('', 'handmux')).toBeNull();
    expect(findTunnelId('not json', 'handmux')).toBeNull();
    expect(findTunnelId('{"oops":1}', 'handmux')).toBeNull();
    expect(findTunnelId(null, 'handmux')).toBeNull();
  });
});

describe('configFromAnswers', () => {
  it('maps none/cloudflare answers straight to a config object', () => {
    expect(configFromAnswers({ tunnel: 'cloudflare', port: 19999 })).toEqual({ tunnel: 'cloudflare', port: 19999 });
  });
  it('maps ssh answers and drops empty optionals', () => {
    expect(configFromAnswers({ tunnel: 'ssh', port: 19999, sshHost: 'me@h', remotePort: 19999, publicUrl: '' }))
      .toEqual({ tunnel: 'ssh', port: 19999, sshHost: 'me@h', remotePort: 19999 });
  });
  it('maps cloudflare-named answers', () => {
    expect(configFromAnswers({ tunnel: 'cloudflare-named', port: 19999, cfHostname: 'h.x.com', cfTunnelName: 'handmux' }))
      .toEqual({ tunnel: 'cloudflare-named', port: 19999, cfHostname: 'h.x.com', cfTunnelName: 'handmux' });
  });
  it('includes name / vapid / xfyun when present, omits when blank', () => {
    expect(configFromAnswers({ tunnel: 'none', port: 19999, name: 'Box', vapid: { public: 'p' } }))
      .toEqual({ tunnel: 'none', port: 19999, name: 'Box', vapid: { public: 'p' } });
    expect(configFromAnswers({ tunnel: 'none', port: 19999, name: '' }))
      .toEqual({ tunnel: 'none', port: 19999 });
  });
});

describe('mergeConfig', () => {
  it('preserves non-wizard fields (token, staticDir) across a re-run', () => {
    const existing = { tunnel: 'none', port: 19999, token: 'keepme', staticDir: '/srv', name: 'Old' };
    const merged = mergeConfig(existing, { tunnel: 'cloudflare', port: 19999, name: 'New' });
    expect(merged).toEqual({ tunnel: 'cloudflare', port: 19999, token: 'keepme', staticDir: '/srv', name: 'New' });
  });
  it('drops the previous tunnel’s stale keys when switching tunnels', () => {
    const existing = { tunnel: 'ssh', port: 19999, sshHost: 'me@box', remotePort: 22, publicUrl: 'https://old.ssh', token: 't' };
    const merged = mergeConfig(existing, { tunnel: 'cloudflare-named', port: 19999, cfHostname: 'h.x.com', cfTunnelName: 'handmux' });
    expect(merged).toEqual({ tunnel: 'cloudflare-named', port: 19999, cfHostname: 'h.x.com', cfTunnelName: 'handmux', token: 't' });
    expect(merged.sshHost).toBeUndefined();
    expect(merged.publicUrl).toBeUndefined();
  });
  it('clears name and turns off push/voice when the answers omit them', () => {
    const existing = { tunnel: 'none', port: 19999, name: 'Old', vapid: { public: 'p' }, xfyun: { appId: 'A' }, token: 't' };
    const merged = mergeConfig(existing, { tunnel: 'none', port: 19999 }); // no name, no vapid, no xfyun
    expect(merged).toEqual({ tunnel: 'none', port: 19999, token: 't' });
  });
});

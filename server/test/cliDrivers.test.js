import { describe, it, expect } from 'vitest';
import { getDriver, DRIVERS } from '../src/cli/drivers.js';
import { extractCloudflareUrl } from '../src/cli/cloudflareUrl.js';
import { lanUrl, publicUrlWithToken } from '../src/cli/supervisor.js';

describe('drivers', () => {
  it('none needs no process', () => {
    expect(DRIVERS.none.needsProcess).toBe(false);
    expect(DRIVERS.none.proc({ port: 1 })).toBeNull();
  });
  it('cloudflare spawns cloudflared against the local port', () => {
    expect(DRIVERS.cloudflare.proc({ port: 8080 }))
      .toEqual({ cmd: 'cloudflared', args: ['tunnel', '--grace-period', '0s', '--url', 'http://localhost:8080'] });
  });
  it('ssh spawns tunlite run with a reverse forward and --json', () => {
    expect(DRIVERS.ssh.proc({ tunliteBin: 'tunlite', sshHost: 'me@h', port: 19999, remotePort: 8443 }))
      .toEqual({ cmd: 'tunlite', args: ['run', '--to', 'me@h', '-R', '8443:localhost:19999', '--name', 'handmux', '--json'] });
  });
  it('ssh appends --jump when a jump host is set', () => {
    const spec = DRIVERS.ssh.proc({ sshHost: 'me@h', port: 1, remotePort: 1, sshJump: 'me@b' });
    expect(spec.cmd).toBe('tunlite');
    expect(spec.args).toContain('--jump');
    expect(spec.args[spec.args.indexOf('--jump') + 1]).toBe('me@b');
  });
  it('ssh matchUrl returns publicUrl only after a connected NDJSON line', () => {
    const cfg = { publicUrl: 'https://my.dev' };
    expect(DRIVERS.ssh.matchUrl('{"state":"starting"}', cfg)).toBeNull();
    expect(DRIVERS.ssh.matchUrl('{"state":"connected"}', cfg)).toBe('https://my.dev');
  });
  it('cloudflare-named runs the named tunnel and reveals https://hostname when ready', () => {
    expect(DRIVERS['cloudflare-named'].proc({ cloudflaredBin: 'cloudflared', cfTunnelName: 'handmux' }))
      .toEqual({ cmd: 'cloudflared', args: ['tunnel', '--grace-period', '0s', 'run', 'handmux'] });
    const cfg = { publicUrl: 'https://handmux.example.com' };
    expect(DRIVERS['cloudflare-named'].matchUrl('Starting tunnel', cfg)).toBeNull();
    expect(DRIVERS['cloudflare-named'].matchUrl('Registered tunnel connection', cfg)).toBe('https://handmux.example.com');
  });
  it('getDriver rejects unknown names', () => {
    expect(() => getDriver('nope')).toThrow(/unknown tunnel/);
  });
});

describe('extractCloudflareUrl', () => {
  it('pulls the hostname out of a real-shaped log line', () => {
    const line = '2026-06-18T10:19 INF +-----+ |  https://simple-oldest-putting-installed.trycloudflare.com  | +-----+';
    expect(extractCloudflareUrl(line)).toBe('https://simple-oldest-putting-installed.trycloudflare.com');
  });
  it('returns null when no url present', () => {
    expect(extractCloudflareUrl('QUIC connection successful')).toBeNull();
    expect(extractCloudflareUrl(null)).toBeNull();
  });
});

describe('url helpers', () => {
  it('lanUrl picks the first external IPv4', () => {
    const ifaces = {
      lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      en0: [{ family: 'IPv4', address: '192.168.1.42', internal: false }],
    };
    expect(lanUrl(8080, ifaces)).toBe('http://192.168.1.42:8080');
  });
  it('embeds the token in the query string', () => {
    expect(publicUrlWithToken('https://x.trycloudflare.com', 'a b'))
      .toBe('https://x.trycloudflare.com/?token=a%20b');
  });
});

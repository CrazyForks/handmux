// Tunnel driver registry. A driver only DESCRIBES how to expose the local server (what process to spawn,
// how to read the public URL out of its output); the supervisor owns process lifecycle (spawn, restart,
// kill). Declarative → unit-testable without spawning. matchUrl receives (chunk, cfg): cloudflare scrapes
// a random URL from logs; ssh / cloudflare-named already KNOW the URL (cfg.publicUrl) and only gate it on
// a readiness signal so the QR isn't shown before the tunnel is live.
import { extractCloudflareUrl } from './cloudflareUrl.js';
import { isTunnelConnected } from './sshTunnel.js';
import { cfNamedReady } from './cfNamed.js';

export const DRIVERS = {
  none: {
    name: 'none',
    needsProcess: false,
    proc: () => null,
    matchUrl: () => null,
  },
  cloudflare: {
    name: 'cloudflare',
    needsProcess: true,
    notFoundHint: 'cloudflared not found — install it (brew install cloudflared)',
    proc: (cfg) => ({
      cmd: cfg.cloudflaredBin || 'cloudflared',
      // --grace-period 0s: drop the edge connection immediately on SIGTERM instead of draining for the 30s
      // default, so `stop`/`restart` don't leave the tunnel lingering on Cloudflare's side (it would look
      // "still running" remotely and overlap a restart). See supervisor.shutdown for the local-process side.
      args: ['tunnel', '--grace-period', '0s', '--url', `http://localhost:${cfg.port}`],
    }),
    matchUrl: (chunk) => extractCloudflareUrl(chunk),
  },
  'cloudflare-named': {
    name: 'cloudflare-named',
    needsProcess: true,
    notFoundHint: 'cloudflared not found — run `handmux setup` to provision the named tunnel',
    proc: (cfg) => ({
      cmd: cfg.cloudflaredBin || 'cloudflared',
      // --grace-period 0s goes BEFORE the `run` subcommand (it's a `cloudflared tunnel` flag). Same reason as
      // the quick tunnel: disconnect immediately on stop so the named tunnel doesn't linger on the edge.
      args: ['tunnel', '--grace-period', '0s', 'run', cfg.cfTunnelName],
    }),
    matchUrl: (chunk, cfg) => (cfNamedReady(chunk) ? cfg.publicUrl : null),
  },
  ssh: {
    name: 'ssh',
    needsProcess: true,
    notFoundHint: 'tunlite not found — install it (npm i -g tunlite / npx tunlite install)',
    proc: (cfg) => ({
      cmd: cfg.tunliteBin || 'tunlite',
      args: ['run', '--to', cfg.sshHost, '-R', `${cfg.remotePort}:localhost:${cfg.port}`,
        '--name', 'handmux', '--json', ...(cfg.sshJump ? ['--jump', cfg.sshJump] : [])],
    }),
    matchUrl: (chunk, cfg) => (isTunnelConnected(chunk) ? cfg.publicUrl : null),
  },
};

export function getDriver(name) {
  const d = DRIVERS[name];
  if (!d) throw new Error(`unknown tunnel: ${name}`);
  return d;
}

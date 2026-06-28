// Resolve a usable `cloudflared` binary so `--tunnel cloudflare` is truly one-click (no brew/manual
// install). Order: $PATH → ~/.handmux/bin/ → download the latest release for this OS/arch from GitHub.
// `which`/`fetchImpl` are injectable so the pure mapping (assetFor) unit-tests offline.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pocketHome } from './state.js';

// Map Node's platform/arch to cloudflared's release asset. Linux/Windows ship a bare binary; macOS
// ships a .tgz that contains a `cloudflared` executable.
export function assetFor(platform = process.platform, arch = process.arch) {
  const a = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: '386' }[arch] || arch;
  if (platform === 'darwin') return { file: `cloudflared-darwin-${a}.tgz`, archive: 'tgz', bin: 'cloudflared' };
  if (platform === 'win32') return { file: `cloudflared-windows-${a}.exe`, archive: null, bin: 'cloudflared.exe' };
  return { file: `cloudflared-linux-${a}`, archive: null, bin: 'cloudflared' };
}

export function onPath(exec = 'cloudflared') {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [exec], { encoding: 'utf8' });
  return r.status === 0 ? String(r.stdout).trim().split(/\r?\n/)[0] : null;
}

export async function resolveCloudflared(home, { which = onPath, fetchImpl, log = console } = {}) {
  const found = which('cloudflared');
  if (found) return found;

  const dir = path.join(pocketHome(home), 'bin');
  const asset = assetFor();
  const dest = path.join(dir, asset.bin);
  if (fs.existsSync(dest)) return dest;

  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) throw new Error('no fetch available to download cloudflared (Node 18+ required)');
  fs.mkdirSync(dir, { recursive: true });
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset.file}`;
  log.log?.(`  downloading cloudflared (${asset.file}) …`);
  const res = await doFetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`cloudflared download failed: HTTP ${res.status} (${url})`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (asset.archive === 'tgz') {
    const tmp = path.join(dir, asset.file);
    fs.writeFileSync(tmp, buf);
    const r = spawnSync('tar', ['xzf', tmp, '-C', dir], { encoding: 'utf8' });
    fs.unlinkSync(tmp);
    if (r.status !== 0) throw new Error(`failed to extract cloudflared: ${r.stderr || r.status}`);
  } else {
    fs.writeFileSync(dest, buf);
  }
  fs.chmodSync(dest, 0o755);
  return dest;
}

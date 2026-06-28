// `handmux setup` wizard. Pure mappers (config shape, cloudflared config.yml, parsing tunnel create
// output) are split out and unit-tested; the readline/spawn shell (runSetup, added in the next task) is
// thin glue on top.

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import webpush from 'web-push';
import { configPath, pocketHome } from './state.js';
import { resolveCloudflared } from './cloudflared.js';
import { resolveTunlite, checkSshAuth } from './tunlite.js';

// ~/.cloudflared/config.yml for a named tunnel: route the hostname to the local handmux port.
export function cfConfigYaml({ tunnelName, credentialsFile, hostname, port }) {
  return [
    `tunnel: ${tunnelName}`,
    `credentials-file: ${credentialsFile}`,
    'ingress:',
    `  - hostname: ${hostname}`,
    `    service: http://localhost:${port}`,
    '  - service: http_status:404',
    '',
  ].join('\n');
}

// Extract the tunnel UUID + credentials path from `cloudflared tunnel create <name>` stdout.
export function parseTunnelCreate(out) {
  const s = String(out || '');
  const id = (s.match(/Created tunnel \S+ with id ([0-9a-fA-F-]+)/) || [])[1] || null;
  const credentialsFile = (s.match(/credentials written to (\S+\.json)/i) || [])[1]?.replace(/\.$/, '') || null;
  return { id, credentialsFile };
}

// Find an existing named tunnel's UUID in `cloudflared tunnel list --output json`. A named tunnel is a
// PERSISTENT object in the Cloudflare account, so a second `setup` would hit `cloudflared tunnel create`'s
// "tunnel with name X already exists" error — which used to force a rename and pile up junk tunnels in the
// account. Looking it up first lets provisioning REUSE it idempotently. Tolerates non-JSON / errors → null.
export function findTunnelId(listJsonOut, name) {
  let arr;
  try { arr = JSON.parse(String(listJsonOut || '')); } catch { return null; }
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((t) => t && t.name === name);
  return hit?.id || null;
}

// The config keys the wizard owns: everything it asks about. mergeConfig wipes these from the existing
// config before re-applying the answers, so a blank answer (or an unselected tunnel) cleanly clears the
// old value instead of leaving a stale field behind. Anything NOT here (token, staticDir, previewDomain…)
// is preserved untouched.
const WIZARD_KEYS = [
  'name', 'port', 'tunnel',
  'sshHost', 'remotePort', 'sshJump', 'cfHostname', 'cfTunnelName', 'publicUrl',
  'vapid', 'xfyun',
];

// Wizard answers → the config fragment the user actually set (omit empty optional fields).
export function configFromAnswers(a) {
  const cfg = { tunnel: a.tunnel, port: a.port };
  if (a.name) cfg.name = a.name;
  if (a.tunnel === 'ssh') {
    cfg.sshHost = a.sshHost;
    cfg.remotePort = a.remotePort;
    if (a.publicUrl) cfg.publicUrl = a.publicUrl;
    if (a.sshJump) cfg.sshJump = a.sshJump;
  }
  if (a.tunnel === 'cloudflare-named') {
    cfg.cfHostname = a.cfHostname;
    cfg.cfTunnelName = a.cfTunnelName;
  }
  if (a.vapid) cfg.vapid = a.vapid;
  if (a.xfyun) cfg.xfyun = a.xfyun;
  return cfg;
}

// Fold this run's answers into an existing config: preserve every non-wizard field, replace the wizard's
// own fields wholesale. This is why re-running `setup` to switch tunnels (or edit the name) never drops
// your token / push keys / static dir, yet also never leaves the previous tunnel's stale keys around.
export function mergeConfig(existing = {}, answers) {
  const out = { ...existing };
  for (const k of WIZARD_KEYS) delete out[k];
  return { ...out, ...configFromAnswers(answers) };
}

const ask = (rl, q, dflt) => new Promise((res) =>
  rl.question(dflt ? `${q} [${dflt}] ` : `${q} `, (a) => res((a.trim() || dflt || ''))));

// [y/N] / [Y/n] prompt. `dfltYes` sets which way a bare Enter goes.
const askYesNo = async (rl, q, dfltYes) => {
  const a = (await ask(rl, `${q} ${dfltYes ? '[Y/n]' : '[y/N]'}`, '')).trim().toLowerCase();
  if (a === '') return dfltYes;
  return a === 'y' || a === 'yes';
};

function readExisting(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// Interactive wizard — the one place to configure handmux. Pre-fills from the existing config so a re-run
// edits/switches rather than starts over, asks name → tunnel → push → voice, and merges the answers back
// (preserving fields it didn't ask about). Returns the resolved config (or null on abort). `home` and the
// write `target` are injectable for tests / `--config`.
export async function runSetup({ home = homedir(), target = configPath(home), log = console } = {}) {
  if (!process.stdin.isTTY) { log.error('handmux setup needs an interactive terminal'); return null; }
  const cur = readExisting(target);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = await ask(rl, 'app name (shown in the browser tab / home-screen icon; blank = default)', cur.name || '');

    log.log('How should your phone reach this machine?');
    log.log('  1) none              — same Wi-Fi / LAN only');
    log.log('  2) cloudflare        — instant, random temporary https URL');
    log.log('  3) cloudflare-named  — your domain, stable HTTPS (most hands-off)');
    log.log('  4) ssh (tunlite)     — your own server / edge');
    const curPick = { none: '1', cloudflare: '2', 'cloudflare-named': '3', ssh: '4' }[cur.tunnel] || '3';
    const pick = await ask(rl, 'choose 1-4', curPick);
    const tunnel = { 1: 'none', 2: 'cloudflare', 3: 'cloudflare-named', 4: 'ssh' }[pick];
    if (!tunnel) { log.error('invalid choice'); return null; }
    const port = Number(await ask(rl, 'server port', String(cur.port || 19999)));

    const answers = { name, tunnel, port };
    if (tunnel === 'cloudflare-named') {
      answers.cfHostname = await ask(rl, 'public hostname (e.g. handmux.example.com)', cur.cfHostname || '');
      answers.cfTunnelName = await ask(rl, 'tunnel name', cur.cfTunnelName || 'handmux');
      await provisionCloudflareNamed({ home, hostname: answers.cfHostname, tunnelName: answers.cfTunnelName, port, log });
    } else if (tunnel === 'ssh') {
      answers.sshHost = await ask(rl, 'ssh host (user@host[:port])', cur.sshHost || '');
      answers.remotePort = Number(await ask(rl, 'remote port on the ssh host', String(cur.remotePort || port)));
      answers.publicUrl = await ask(rl, 'public url (blank = http://host:remotePort)', cur.publicUrl || '');
      await provisionSsh({ sshHost: answers.sshHost, log });
    }

    answers.vapid = await askPush(rl, cur.vapid, log);
    answers.xfyun = await askVoice(rl, cur.xfyun, log);

    const cfg = mergeConfig(cur, answers);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    log.log(`✓ wrote ${target}`);
    if (tunnel === 'ssh') printSshServerHelp(answers, log);
    if (tunnel === 'cloudflare-named' || tunnel === 'ssh') printPreviewHelp(tunnel, log);
    return cfg;
  } finally { rl.close(); }
}

// Push notifications need a VAPID keypair. If one already exists we offer to keep it (regenerating would
// invalidate every existing phone subscription); otherwise we generate one on the spot — the only painful
// part of push setup, done for the user. Returns the vapid object, or undefined to leave push off.
async function askPush(rl, existing, log) {
  if (existing) {
    if (await askYesNo(rl, 'keep push notifications configured?', true)) return existing;
    return undefined;
  }
  if (!await askYesNo(rl, 'set up push notifications now? (generates VAPID keys)', false)) return undefined;
  const { publicKey, privateKey } = webpush.generateVAPIDKeys();
  const subject = await ask(rl, 'contact (mailto: or https URL, for the push service)', 'mailto:admin@example.com');
  log.log('✓ generated VAPID keypair');
  return { public: publicKey, private: privateKey, subject };
}

// Voice input (iFlytek/xfyun) — three credentials from their console; no generation possible, just paste.
async function askVoice(rl, existing, log) {
  if (existing) {
    if (await askYesNo(rl, 'keep voice input configured?', true)) return existing;
    return undefined;
  }
  if (!await askYesNo(rl, 'set up voice input now? (needs iFlytek/xfyun keys)', false)) return undefined;
  const appId = await ask(rl, 'xfyun appId');
  const apiKey = await ask(rl, 'xfyun apiKey');
  const apiSecret = await ask(rl, 'xfyun apiSecret');
  if (!appId || !apiKey || !apiSecret) { log.log('  (skipped — missing fields)'); return undefined; }
  return { appId, apiKey, apiSecret };
}

// login (browser) → create → route dns → write config.yml. The only human step is the browser login.
async function provisionCloudflareNamed({ home, hostname, tunnelName, port, log }) {
  const bin = await resolveCloudflared(home);
  const cfDir = path.join(home, '.cloudflared');
  if (!fs.existsSync(path.join(cfDir, 'cert.pem'))) {
    log.log('→ logging in to Cloudflare (a browser will open) …');
    spawnSync(bin, ['tunnel', 'login'], { stdio: 'inherit' });
  }
  // Idempotent: reuse the tunnel if it already exists (re-running setup, or after a stop), else create it.
  // Without this, `tunnel create` errors "already exists" and you'd have to keep renaming — leaving orphan
  // tunnels piling up in the Cloudflare account.
  const listed = spawnSync(bin, ['tunnel', 'list', '--output', 'json'], { encoding: 'utf8' });
  let id = findTunnelId(listed.stdout, tunnelName);
  let credentialsFile = null;
  if (id) {
    log.log(`✓ reusing existing tunnel ${tunnelName} (${id})`);
    credentialsFile = path.join(cfDir, `${id}.json`);
    if (!fs.existsSync(credentialsFile)) {
      log.error(`⚠ credentials file ${credentialsFile} not found on this machine — the tunnel was likely`);
      log.error(`  created elsewhere. Run \`${bin} tunnel delete ${tunnelName}\` and re-run setup to recreate it here.`);
    }
  } else {
    log.log(`→ creating tunnel ${tunnelName} …`);
    const created = spawnSync(bin, ['tunnel', 'create', tunnelName], { encoding: 'utf8' });
    process.stdout.write(created.stdout || ''); process.stderr.write(created.stderr || '');
    const parsed = parseTunnelCreate(`${created.stdout || ''}\n${created.stderr || ''}`);
    id = parsed.id;
    credentialsFile = parsed.credentialsFile;
  }
  log.log(`→ routing ${hostname} → tunnel …`);
  // --overwrite-dns: re-running setup (or pointing a hostname already routed) must not error on the DNS step.
  const routed = spawnSync(bin, ['tunnel', 'route', 'dns', '--overwrite-dns', tunnelName, hostname], { encoding: 'utf8' });
  if (routed.status !== 0) {
    process.stderr.write(routed.stderr || '');
    log.error(`⚠ route dns failed — is ${hostname.split('.').slice(-2).join('.')}'s DNS hosted on Cloudflare?`);
    log.error('  Add the domain on Cloudflare (free) and point its nameservers there, then re-run setup.');
  }
  fs.mkdirSync(cfDir, { recursive: true });
  fs.writeFileSync(path.join(cfDir, 'config.yml'),
    cfConfigYaml({ tunnelName, credentialsFile: credentialsFile || path.join(cfDir, `${id || tunnelName}.json`), hostname, port }));
  log.log(`✓ wrote ${path.join(cfDir, 'config.yml')}`);
}

// drive tunlite passwordless setup inline (one password) if not already set up.
async function provisionSsh({ sshHost, log }) {
  const bin = resolveTunlite();
  if (checkSshAuth(sshHost, { bin }) === 0) { log.log('✓ passwordless SSH already set up'); return; }
  log.log(`→ setting up passwordless SSH to ${sshHost} (you'll enter the password once) …`);
  spawnSync(bin, ['setup-key', sshHost], { stdio: 'inherit' });
}

function printSshServerHelp(a, log) {
  log.log('');
  log.log('Server side (one-time): point a reverse proxy at the forwarded loopback port.');
  log.log(`  nginx:  proxy_pass http://127.0.0.1:${a.remotePort};  (add client_max_body_size 60m; proxy_read_timeout 90s;)`);
  log.log(`  caddy:  ${a.publicUrl || '<your-domain>'} {  reverse_proxy 127.0.0.1:${a.remotePort}  }`);
  log.log('');
}

// FYI on dynamic port preview: it's optional and NOT wired by this wizard (separate wildcard domain). Print
// the requirement + a TLS note that fits the chosen tunnel — Cloudflare's free cert only covers one level
// (so deeper needs ACM), whereas on the ssh/own-edge path the user serves their own wildcard cert. Shown
// only for wildcard-capable tunnels (a quick tunnel can't do wildcards at all).
function printPreviewHelp(tunnel, log) {
  log.log('Optional — dynamic port preview (open a dev server by port on your phone):');
  log.log('  set  "previewDomain": "..."  in the config, and route the wildcard preview domain to the gateway.');
  if (tunnel === 'cloudflare-named') {
    log.log("  TLS: Cloudflare's free cert covers ONE level (*.example.com); deeper (*.preview.example.com) needs Advanced Certificate Manager.");
  } else {
    log.log("  TLS: your edge serves the wildcard cert (e.g. a Let's Encrypt *.preview.your.domain).");
  }
  log.log('');
}

#!/usr/bin/env node
// handmux CLI — install once (`npm i -g handmux`), then drive it with start/stop/restart/status.
//
// The whole config story is two doors:
//   handmux start   — just run it. No config needed: defaults to `none` (LAN-only), auto-generates a
//                     token, prints the (token-free) URL + a QR of it, and the token on its own line. Flags
//                     let you try variations for one run (e.g. --tunnel cloudflare).
//   handmux setup   — the one place to configure persistently. Interactive; writes ~/.handmux/config.json
//                     (name, tunnel, push, voice). Re-run it to change anything.
// `start` reads that file; with no file it uses defaults. Precedence: flag > file > default — a flag
// overrides one value for one run and never persists. Advanced: `--config PATH` (a different file, for
// dev / multiple configs), `handmux config` (show what's in effect and where each value came from).
//
// Tunnels: `none` (LAN only, nothing exposed) · `cloudflare` (instant random https URL) ·
// `cloudflare-named` (stable URL on your own Cloudflare domain) · `ssh` (reverse-forward to your own
// server via `tunlite run`). `handmux setup` wires any of these up interactively.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { parseArgs, resolveConfig, explainConfig } from '../src/cli/options.js';
import { renderCompactQr } from '../src/cli/qr.js';
import { supervise, bareUrl, publicUrlWithToken } from '../src/cli/supervisor.js';
import { resolveCloudflared } from '../src/cli/cloudflared.js';
import { resolveTunlite, checkSshAuth } from '../src/cli/tunlite.js';
import { installService, uninstallService } from '../src/cli/service.js';
import { checkTmux, MIN_TMUX, tmuxInstallHint } from '../src/cli/tmuxVersion.js';
import { readState, clearState, isAlive, pocketHome, logPath, configPath, claudeStatePath } from '../src/cli/state.js';
import { runSetup } from '../src/cli/setupWizard.js';
import { hooksStatus, installHooks, uninstallHooks } from '../src/cli/claudeHooks.js';
import { tmuxDotStatus, installTmuxDot, tmuxConfPath } from '../src/cli/tmuxConf.js';
import { probe } from '../src/cli/probe.js';

const HOME = homedir();
const SELF = fileURLToPath(import.meta.url);
const HOOKS_SRC = path.resolve(path.dirname(SELF), '../hooks'); // server/hooks (bundled scripts)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { command, flags } = parseArgs(process.argv.slice(2));

// There is ONE config file location: ~/.handmux/config.json (written by `handmux setup`). `--config PATH`
// points elsewhere — that's the only escape, and it covers dev/multi-config without any cwd magic (a
// stray ./config.json never gets picked up silently). No file merging or inheritance: at most one file is
// read. Flags (applied later in resolveConfig) override individual settings from it for that one run and
// never persist. Returns { path, cfg } — path is the file used (or null), for the startup print so it's
// never ambiguous what a run loaded.
function resolveFileConfig() {
  let p = null;
  if (flags.config) {                                              // explicit: must exist
    p = path.resolve(flags.config);
    if (!fs.existsSync(p)) { console.error(`✗ --config ${p}: not found`); process.exit(2); }
  } else {
    const homeP = configPath(HOME);
    if (fs.existsSync(homeP)) p = homeP;
  }
  if (!p) return { path: null, cfg: {} };
  try { return { path: p, cfg: JSON.parse(fs.readFileSync(p, 'utf8')) }; }
  catch (e) { console.error(`✗ bad config ${p}: ${e.message}`); process.exit(2); }
}

// Human-readable summary of which config file a run loaded.
function describeConfig(p) {
  return p || '(none — flags + defaults)';
}

// 一次性 [Y/n] 提问(默认 Yes)。非 TTY 直接返回 false,绝不卡住。
async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await new Promise((res) => rl.question(`${question} [Y/n] `, res))).trim().toLowerCase();
    return a === '' || a === 'y' || a === 'yes';
  } finally { rl.close(); }
}

// ssh 隧道预检:解析 tunlite → 免密就绪?有 TTY 就内嵌 setup-key(输一次密码)再复检,无 TTY 快速失败。
async function preflightSsh(cfg) {
  cfg.tunliteBin = resolveTunlite();                 // 抛出 → 调用方打印并退出
  if (checkSshAuth(cfg.sshHost, { bin: cfg.tunliteBin }) === 0) return;
  if (process.stdin.isTTY && await confirm(`passwordless SSH to ${cfg.sshHost} is not set up. Configure it now?`)) {
    spawnSync(cfg.tunliteBin, ['setup-key', cfg.sshHost], { stdio: 'inherit' });
    if (checkSshAuth(cfg.sshHost, { bin: cfg.tunliteBin }) === 0) return;
  }
  throw new Error(`passwordless SSH not set up — run: ${cfg.tunliteBin} setup-key ${cfg.sshHost}`);
}

async function main() {
  switch (command) {
    case 'start': return start();
    case 'stop': stop(); return;
    case 'restart': { stop(); await sleep(600); return start(); }
    case 'status': return status();
    case 'logs': return logs();
    case 'config': return configCmd();
    case 'setup': return setupCmd();
    case 'hooks': return hooksCmd();
    case 'service': return serviceCmd();
    case '__supervise': return runSupervise();
    case 'version': case '--version': case '-v': return version();
    default: return help();
  }
}

// `handmux --version` / `-v` — print the package version (read from this package's package.json, so it
// stays in lockstep with what npm installed; no hardcoded string to forget to bump).
function version() {
  console.log(requireOpt('../package.json').version);
}

async function start() {
  const { path: cfgPath, cfg: fileCfg } = resolveFileConfig();
  console.log(`config: ${describeConfig(cfgPath)}`);
  let cfg;
  try { cfg = resolveConfig(flags, fileCfg); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }

  // Make a one-run tunnel override visible: it's easy to forget a --tunnel flag is shadowing the file.
  if (flags.tunnel && fileCfg.tunnel && flags.tunnel !== fileCfg.tunnel) {
    console.log(`  ↳ --tunnel ${flags.tunnel} overrides config (${fileCfg.tunnel}) for this run only`);
  }

  // tmux is the whole point — absent is fatal; an untested-old version only warns (rendering may drift).
  const tmux = checkTmux();
  if (!tmux.present) {
    console.error('✗ tmux not found.');
    console.error('  handmux runs on top of tmux (a terminal multiplexer) — it drives your real tmux');
    console.error('  panes from your phone, so you need tmux on this machine first.');
    console.error('');
    console.error(`  Install it:  ${tmuxInstallHint()}`);
    console.error('  Then run `handmux start` again.');
    process.exit(1);
  }
  if (!tmux.ok) console.warn(`⚠ tmux ${tmux.raw} is below the tested minimum ${MIN_TMUX}; terminal rendering may be off`);

  const existing = readState(HOME);
  if (existing && isAlive(existing.supervisorPid)) {
    console.log(`handmux already running (pid ${existing.supervisorPid}) — use 'handmux restart'`);
    await printAccess(existing);
    return;
  }

  // cloudflare needs a cloudflared binary; resolve (and auto-download) it up front so the failure is a
  // clear message here rather than a silent child that never prints a URL.
  if (cfg.tunnel === 'cloudflare') {
    try { cfg.cloudflaredBin = await resolveCloudflared(HOME); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  }
  if (cfg.tunnel === 'cloudflare-named') {
    try { cfg.cloudflaredBin = await resolveCloudflared(HOME); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
    if (!fs.existsSync(path.join(HOME, '.cloudflared', 'config.yml'))) {
      console.error('✗ named tunnel not provisioned — run `handmux setup` first'); process.exit(1);
    }
  }
  if (cfg.tunnel === 'ssh') {
    try { await preflightSsh(cfg); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  }

  if (cfg.foreground) {
    supervise(cfg, { home: HOME });
    console.log(`starting handmux (tunnel: ${cfg.tunnel}, port: ${cfg.port}) — Ctrl-C to stop`);
    await waitAndPrint(false);
    return;
  }

  fs.mkdirSync(pocketHome(HOME), { recursive: true });
  const out = fs.openSync(logPath(HOME), 'a');
  const payload = Buffer.from(JSON.stringify(cfg)).toString('base64');
  const child = spawn(process.execPath, [SELF, '__supervise', '--payload', payload],
    { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  console.log(`starting handmux (tunnel: ${cfg.tunnel}, port: ${cfg.port}) …`);
  await waitAndPrint(true);
}

function stop() {
  const st = readState(HOME);
  if (!st || !isAlive(st.supervisorPid)) { console.log('handmux not running'); clearState(HOME); return; }
  try { process.kill(st.supervisorPid, 'SIGTERM'); } catch { /* race: already gone */ }
  console.log(`stopped handmux (pid ${st.supervisorPid})`);
}

async function status() {
  const st = readState(HOME);
  if (!st || !isAlive(st.supervisorPid)) { console.log('● handmux stopped'); return; }
  console.log('● handmux running');
  await printAccess(st);
}

function runSupervise() {
  const cfg = JSON.parse(Buffer.from(flags.payload, 'base64').toString('utf8'));
  supervise(cfg, { home: HOME });
}

function logs() {
  const p = logPath(HOME);
  if (!fs.existsSync(p)) { console.log('(no log yet — start handmux first)'); return; }
  const lines = String(flags.lines || 200);
  const args = flags.follow ? ['-n', lines, '-f', p] : ['-n', lines, p];
  spawn('tail', args, { stdio: 'inherit' });
}

// `handmux service install|uninstall` — the autostart subsystem, mirroring `handmux hooks …`: subsystem
// name first, then the action. `install` bakes the resolved config into an OS autostart entry (launchd /
// systemd --user) that runs the supervisor at login; `uninstall` removes it. The action is argv[3].
async function serviceCmd() {
  const sub = process.argv[3];
  if (sub === 'install') return serviceInstall();
  if (sub === 'uninstall') {
    try { uninstallService({ home: HOME }); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
    return;
  }
  console.error('usage: handmux service install [start-flags] | handmux service uninstall');
  process.exit(2);
}

async function serviceInstall() {
  const { path: cfgPath, cfg: fileCfg } = resolveFileConfig();
  console.log(`config: ${describeConfig(cfgPath)}`);
  let cfg;
  try { cfg = resolveConfig(flags, fileCfg); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  if (cfg.tunnel === 'cloudflare' || cfg.tunnel === 'cloudflare-named') {
    try { cfg.cloudflaredBin = await resolveCloudflared(HOME); }
    catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  }
  if (cfg.tunnel === 'ssh') {
    // 开机自启无 TTY:要求事先已配好免密,否则快速失败。
    cfg.tunliteBin = resolveTunlite();
    if (checkSshAuth(cfg.sshHost, { bin: cfg.tunliteBin }) !== 0) {
      console.error(`✗ passwordless SSH not set up — run: ${cfg.tunliteBin} setup-key ${cfg.sshHost}`); process.exit(1);
    }
  }
  const payload = Buffer.from(JSON.stringify(cfg)).toString('base64');
  const args = [process.execPath, SELF, '__supervise', '--payload', payload];
  try { installService(args, { home: HOME }); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
  console.log("handmux will now start at login. 'handmux service uninstall' to remove.");
}

async function setupCmd() {
  const target = flags.config ? path.resolve(flags.config) : configPath(HOME);
  const cfg = await runSetup({ home: HOME, target });
  if (!cfg) { process.exit(2); }
  const hs = hooksStatus(HOME);
  if (hs !== 'no-claude' && hs !== 'installed'
      && await confirm('Enable Claude Code notifications (inbox)?')) {
    installHooks(HOME, { srcDir: HOOKS_SRC, stateFile: claudeStatePath(HOME) });
    console.log('✓ Claude hooks installed.');
    await maybeOfferTmuxDot();
  }
  if (await confirm('Start handmux now?')) { Object.assign(flags, cfg); return start(); }
  console.log("run 'handmux start' when you're ready.");
}

// The per-window tmux status dot is the natural companion to the inbox hooks: the hook already writes a
// colour into each window's `@claude_dot` on every Claude event, but tmux only SHOWS it if
// `window-status-format` references it — otherwise it's a silent no-op. Offer to add that display block to
// ~/.tmux.conf (opt-in, idempotent). Skip when it's already wired (ours or hand-rolled). Non-TTY: just hint.
async function maybeOfferTmuxDot() {
  if (tmuxDotStatus(HOME) !== 'absent') return;
  if (!process.stdin.isTTY) {
    console.log(`  Tip: to show a Claude status dot on each tmux window, run \`handmux hooks install\` from an interactive terminal — it wires ${tmuxConfPath(HOME)} for you (see tmux/README.md in the handmux package).`);
    return;
  }
  if (await confirm('Also show a per-window Claude status dot in tmux? (adds a block to ~/.tmux.conf)')) {
    installTmuxDot(HOME);
    console.log(`✓ tmux dot added → ${tmuxConfPath(HOME)}`);
    console.log('  Apply with: tmux source-file ~/.tmux.conf  (it changes the shared tmux server — all clients, including your PC).');
  }
}

// `handmux hooks install|uninstall` — opt-in wiring of the Claude Code lifecycle hooks that drive the
// inbox/push. Never creates ~/.claude; if Claude Code isn't present we say so and exit 0 (nothing to do).
async function hooksCmd() {
  const sub = process.argv[3];
  if (sub === 'install') {
    if (hooksStatus(HOME) === 'no-claude') {
      console.log('Claude Code not detected (~/.claude missing) — nothing to install.');
      return;
    }
    installHooks(HOME, { srcDir: HOOKS_SRC, stateFile: claudeStatePath(HOME) });
    console.log('✓ Claude hooks installed → ~/.claude/settings.json');
    console.log('  Restart or open a new Claude Code session to load them; the inbox lights up as panes report.');
    await maybeOfferTmuxDot();
    return;
  }
  if (sub === 'uninstall') {
    uninstallHooks(HOME);
    console.log('✓ Claude hooks removed.');
    return;
  }
  console.error('usage: handmux hooks install|uninstall');
  process.exit(2);
}

// `handmux config` — read-only: print the config that WOULD be used, with each value's origin (flag /
// the config file path / env / default). This is the answer to "what's actually in effect and where did
// it come from", so flag-vs-file is never a mystery. Secrets are masked.
function configCmd() {
  const { path: cfgPath, cfg: fileCfg } = resolveFileConfig();
  let rows;
  try { rows = explainConfig(flags, fileCfg, cfgPath); }
  catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  console.log(`config file: ${cfgPath || '(none — using defaults; run `handmux setup` to create one)'}`);
  console.log('');
  const w = Math.max(...rows.map((r) => r.key.length));
  for (const r of rows) {
    console.log(`  ${r.key.padEnd(w)}  ${r.display}  ${r.origin === 'default' ? '' : `· ${r.origin}`}`.trimEnd());
  }
  console.log('');
  console.log('  origin: flag (this run only) · file · env · default');
}

// Poll state.json until the public URL (or an error) shows up, then print access info. cloudflare needs
// a few seconds to hand back its hostname; none is instant.
async function waitAndPrint(exitWhenDone) {
  const deadline = Date.now() + 25000;
  let st;
  for (;;) {
    st = readState(HOME);
    if (st && ((st.publicUrl && st.ready) || st.error)) break;
    if (Date.now() > deadline) break;
    await sleep(300);
  }
  await printAccess(st);
  if (st?.error) process.exitCode = 1;
  if (exitWhenDone) process.exit(process.exitCode || 0);
}

async function printAccess(st) {
  if (!st) { console.log('  (no state)'); return; }
  if (st.error) { console.error(`  ✗ ${st.error}`); return; }
  const scan = bareUrl(st.publicUrl);
  console.log('');
  console.log(`  tunnel   ${st.tunnel}   ·   pid ${st.supervisorPid}`);
  console.log(`  🌐 open   ${scan || '(pending…)'}`);
  if (st.tunnel === 'none' && st.lanUrl) console.log(`  📶 lan    ${bareUrl(st.lanUrl)}`);
  console.log(`  💻 local  ${bareUrl(st.localUrl)}`);
  console.log(`  🔑 token  ${st.token}`);
  // The QR carries the token so a phone scan signs in one-tap; the PRINTED links above stay token-free
  // (safe to screenshot/share — paste the token shown above to sign in there).
  await maybeQr(st.publicUrl ? publicUrlWithToken(st.publicUrl, st.token) : scan, st);
  if (st.publicUrl && st.tunnel !== 'none') {
    const ok = await probe(st.publicUrl);
    if (ok) console.log('  ✓ reachable');
    else console.log(`  ⚠ tunnel up but ${st.publicUrl} did not answer — check the server-side reverse proxy / DNS`);
  }
  console.log('');
  console.log(`  handmux status | stop`);
  console.log('');
}

// Best-effort QR (optional dependency). We borrow qrcode-terminal's QR *model* (vendored, dependency-free)
// to get the module matrix, then render it ourselves with vertical half-blocks (see qr.js) so it comes out
// square on a 2:1 terminal cell. If qrcode-terminal isn't installed we just skip it — the URL above is
// always printed.
const requireOpt = createRequire(import.meta.url);
async function maybeQr(url, st) {
  if (!url) return;
  try {
    const QRCode = requireOpt('qrcode-terminal/vendor/QRCode');
    const ECL = requireOpt('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
    const qr = new QRCode(-1, ECL.L);
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const matrix = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
    process.stdout.write(renderCompactQr(matrix) + '\n');
  } catch { /* no qrcode-terminal — URL alone is fine */ }
}

function help() {
  console.log(`handmux — drive your tmux from your phone

  handmux start            run it (defaults to LAN-only; no config needed)
  handmux setup            configure tunnel / name / notifications (writes config; re-run to change)
  handmux stop | restart | status
  handmux logs [--follow] [--lines N]

The model: 'start' runs · 'setup' configures (writes ~/.handmux/config.json) · re-run setup to change.
A flag overrides one value for one run and never persists (flag > file > default).

advanced (scripting / multiple configs):
  handmux config                        show the effective config + where each value came from
  handmux hooks install|uninstall         enable/disable Claude Code notifications (inbox)
  handmux service install [start-flags]   start at login (launchd/systemd)
  handmux service uninstall               remove the autostart entry
  --config PATH             use this config file instead of ~/.handmux/config.json (dev / multi-config)
  --version, -v            print the handmux version

start flags (one-run overrides — for persistence use 'handmux setup'):
  --tunnel none|cloudflare|cloudflare-named|ssh   expose method (default: none)
  --ssh-host user@host[:port]   ssh tunnel target (tunlite)
  --remote-port N               port bound on the ssh host (default: --port)
  --public-url URL              public url to advertise (any tunnel, incl. none if you run your own;
                                ssh defaults to http://host:remotePort)
  --ssh-jump u@h[,…]            optional bastion for ssh
  --cf-hostname H               public hostname for cloudflare-named
  --cf-tunnel-name N            tunnel name for cloudflare-named (default: handmux)
  --port N                  server port (default: 19999)
  --host H                  bind host (default: 0.0.0.0)
  --token S                 auth token (default: generated)
  --name "My Box"           app name in the browser tab + home-screen icon label
  --preview-domain D        enable dynamic previews (needs wildcard subdomain)
  --foreground, -f          run in the foreground (don't daemonize)
  --no-qr                   don't render the QR code
`);
}

main();

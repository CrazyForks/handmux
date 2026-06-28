// Boot/login autostart. The OS keeps the handmux SUPERVISOR (`__supervise`) alive; the supervisor
// keeps server + tunnel alive — same model as a foreground run, just parented by launchd/systemd.
// The intended config is baked into the service file as a base64 payload (self-contained: no reliance
// on config.json). Text generators are pure (unit-tested); the launchctl/systemctl calls inject `exec`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pocketHome, logPath } from './state.js';

export const LABEL = 'com.handmux.agent';
export const UNIT = 'handmux.service';

export function plistPath(home) { return path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`); }
export function unitPath(home) { return path.join(home, '.config', 'systemd', 'user', UNIT); }

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// launchd LaunchAgent. args = full argv for the process (node, script, __supervise, --payload, b64).
export function plistFor({ args, log, label = LABEL }) {
  const items = args.map((a) => `    <string>${xmlEscape(a)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xmlEscape(log)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(log)}</string>
</dict>
</plist>
`;
}

// systemd --user unit. ExecStart needs a single command line; args are space-joined (our args have no
// spaces except an absolute path with none in practice — quote the script path defensively).
export function unitFor({ args }) {
  const cmd = args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
  return `[Unit]
Description=handmux — drive your tmux from your phone
After=network-online.target

[Service]
ExecStart=${cmd}
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}

export function installService(args, { home, platform = process.platform, exec = spawnSync, log = console } = {}) {
  if (platform === 'darwin') {
    const p = plistPath(home);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, plistFor({ args, log: logPath(home) }));
    exec('launchctl', ['unload', p], { stdio: 'ignore' }); // best-effort: clear any prior load
    const r = exec('launchctl', ['load', '-w', p], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`launchctl load failed: ${r.stderr || r.status}`);
    log.log?.(`installed launchd agent: ${p}`);
    return p;
  }
  if (platform === 'linux') {
    const p = unitPath(home);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, unitFor({ args }));
    exec('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    const r = exec('systemctl', ['--user', 'enable', '--now', UNIT], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`systemctl enable failed: ${r.stderr || r.status}`);
    log.log?.(`installed systemd --user unit: ${p}`);
    log.log?.('(for autostart before login: loginctl enable-linger "$USER")');
    return p;
  }
  throw new Error(`autostart not supported on ${platform} yet`);
}

export function uninstallService({ home, platform = process.platform, exec = spawnSync, log = console } = {}) {
  if (platform === 'darwin') {
    const p = plistPath(home);
    exec('launchctl', ['unload', '-w', p], { stdio: 'ignore' });
    try { fs.unlinkSync(p); } catch { /* already gone */ }
    log.log?.(`removed launchd agent: ${p}`);
    return;
  }
  if (platform === 'linux') {
    exec('systemctl', ['--user', 'disable', '--now', UNIT], { stdio: 'ignore' });
    try { fs.unlinkSync(unitPath(home)); } catch { /* already gone */ }
    exec('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    log.log?.(`removed systemd --user unit: ${unitPath(home)}`);
    return;
  }
  throw new Error(`autostart not supported on ${platform} yet`);
}

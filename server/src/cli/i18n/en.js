// English catalog (the fallback locale). Keys are grouped by command/area. `{var}` placeholders are filled
// by translate(). Keep this in lockstep with zh.js — a missing zh key silently falls back to the line here.
export default {
  // generic
  'err.generic': '✗ {msg}',
  'err.configNotFound': '✗ --config {path}: not found',
  'err.badConfig': '✗ bad config {path}: {msg}',
  'err.namedNotProvisioned': '✗ named tunnel not provisioned — run `handmux setup` first',

  // config line printed at the top of start / service install
  'config.loaded': 'config: {path}',
  'config.none': '(none — flags + defaults)',

  // ssh preflight
  'ssh.confirmSetup': 'passwordless SSH to {host} is not set up. Configure it now?',
  'ssh.notSetup': 'passwordless SSH not set up — run: {bin} setup-key {host}',

  // tmux presence / version
  'tmux.notFound': '✗ tmux not found.',
  'tmux.explain1': '  handmux runs on top of tmux (a terminal multiplexer) — it drives your real tmux',
  'tmux.explain2': '  panes from your phone, so you need tmux on this machine first.',
  'tmux.install': '  Install it:  {hint}',
  'tmux.thenStart': '  Then run `handmux start` again.',
  'tmux.tooOld': '⚠ tmux {raw} is below the tested minimum {min}; terminal rendering may be off',

  // start — already running
  'start.running.same': 'handmux is already running — open the address below.',
  'start.running.changedHead': 'handmux is already running (tunnel: {tunnel}). A running instance does NOT pick up config changes on its own:',
  'start.running.changedRow': '  • {key}: {from} → {to} (what you asked for now)',
  'start.running.switchQ': 'Switch to the new settings now? (restarts handmux)',
  'start.running.hint': "Leaving it as-is. Run 'handmux restart' whenever you want to apply the new settings.",

  // start — launching
  'start.overrides': '  ↳ --tunnel {flag} overrides config ({file}) for this run only',
  'start.foreground': 'starting handmux (tunnel: {tunnel}, port: {port}) — Ctrl-C to stop',
  'start.starting': 'starting handmux (tunnel: {tunnel}, port: {port}) …',

  // stop / status
  'stop.notRunning': 'handmux not running',
  'stop.stopped': 'stopped handmux (pid {pid})',
  'status.stopped': '● handmux stopped',
  'status.running': '● handmux running',

  // logs
  'logs.none': '(no log yet — start handmux first)',

  // access block (printAccess)
  'access.noState': '  (no state)',
  'access.error': '  ✗ {msg}',
  'access.tunnel': '  tunnel   {tunnel}   ·   pid {pid}',
  'access.open': '  🌐 open   {url}',
  'access.pending': '(pending…)',
  'access.lan': '  📶 lan    {url}',
  'access.local': '  💻 local  {url}',
  'access.token': '  🔑 token  {token}',
  'access.reachable': '  ✓ reachable',
  'access.unreachable': '  ⚠ tunnel up but {url} did not answer — check the server-side reverse proxy / DNS',
  'access.hint': '  handmux status | stop',

  // hooks
  'hooks.confirmEnable': 'Enable coding-agent notifications (inbox)?',
  'hooks.installedShort': '✓ Agent hooks installed.',
  'hooks.noClaude': 'Claude Code not detected (~/.claude missing) — nothing to install.',
  'hooks.noAgents': 'No coding agent detected (~/.claude and ~/.codex both missing) — nothing to install.',
  'hooks.installed': '✓ Claude hooks installed → ~/.claude/settings.json',
  'hooks.installedClaude': '✓ Claude Code hooks installed → ~/.claude/settings.json',
  'hooks.installedCodex': '✓ Codex hooks installed → ~/.codex/config.toml (notify)',
  'hooks.codexConflict': "⚠ Codex already has its own notify program in {path} — left untouched. To use both, chain handmux's handmux-codex-notify.cjs from yours.",
  'hooks.installedHint': '  Restart or open a new agent session to load them; the inbox lights up as panes report.',
  'hooks.removed': '✓ Agent hooks removed.',
  'hooks.usage': 'usage: handmux hooks install|uninstall',

  // tmux status-dot offer
  'tmuxdot.tip': '  Tip: to show a Claude status dot on each tmux window, run `handmux hooks install` from an interactive terminal — it wires {conf} for you (see tmux/README.md in the handmux package).',
  'tmuxdot.confirm': 'Also show a per-window Claude status dot in tmux? (adds a block to ~/.tmux.conf)',
  'tmuxdot.added': '✓ tmux dot added → {path}',
  'tmuxdot.apply': '  Apply with: tmux source-file ~/.tmux.conf  (it changes the shared tmux server — all clients, including your PC).',

  // service
  'service.usage': 'usage: handmux service install [start-flags] | handmux service uninstall',
  'service.installed': "handmux will now start at login. 'handmux service uninstall' to remove.",

  // config command
  'configcmd.file': 'config file: {path}',
  'configcmd.fileNone': '(none — using defaults; run `handmux setup` to create one)',
  'configcmd.legend': '  origin: flag (this run only) · file · env · default',

  // setup wizard
  'setup.confirmStart': 'Start handmux now?',
  'setup.later': "run 'handmux start' when you're ready.",
  'setup.needTty': 'handmux setup needs an interactive terminal',
  'setup.langQ': 'Language / 语言',
  'setup.lang1': '  1) English',
  'setup.lang2': '  2) 中文',
  'setup.askName': 'app name (shown in the browser tab / home-screen icon; blank = default)',
  'setup.tunnelQ': 'How should your phone reach this machine?',
  'setup.tunnel1': '  1) none              — same Wi-Fi / LAN only',
  'setup.tunnel2': '  2) cloudflare        — instant, random temporary https URL',
  'setup.tunnel3': '  3) cloudflare-named  — your domain, stable HTTPS (most hands-off)',
  'setup.tunnel4': '  4) ssh (tunlite)     — your own server / edge',
  'setup.choose': 'choose 1-4',
  'setup.invalid': 'invalid choice',
  'setup.askPort': 'server port',
  'setup.askHostname': 'public hostname (e.g. handmux.example.com)',
  'setup.askTunnelName': 'tunnel name',
  'setup.askSshHost': 'ssh host (user@host[:port])',
  'setup.askRemotePort': 'remote port on the ssh host',
  'setup.askPublicUrl': 'public url (blank = http://host:remotePort)',
  'setup.wrote': '✓ wrote {path}',
  'setup.pushKeep': 'keep push notifications configured?',
  'setup.pushSetup': 'set up push notifications now? (generates VAPID keys)',
  'setup.pushContact': 'contact (mailto: or https URL, for the push service)',
  'setup.pushGenerated': '✓ generated VAPID keypair',
  'setup.voiceKeep': 'keep voice input configured?',
  'setup.voiceSetup': 'set up voice input now? (needs iFlytek/xfyun keys)',
  'setup.voiceAppId': 'xfyun appId',
  'setup.voiceApiKey': 'xfyun apiKey',
  'setup.voiceApiSecret': 'xfyun apiSecret',
  'setup.voiceSkipped': '  (skipped — missing fields)',
  'setup.cfLogin': '→ logging in to Cloudflare (a browser will open) …',
  'setup.cfReuse': '✓ reusing existing tunnel {name} ({id})',
  'setup.cfCredMissing1': '⚠ credentials file {file} not found on this machine — the tunnel was likely',
  'setup.cfCredMissing2': '  created elsewhere. Run `{bin} tunnel delete {name}` and re-run setup to recreate it here.',
  'setup.cfCreate': '→ creating tunnel {name} …',
  'setup.cfRoute': '→ routing {host} → tunnel …',
  'setup.cfRouteFail': "⚠ route dns failed — is {domain}'s DNS hosted on Cloudflare?",
  'setup.cfRouteFail2': '  Add the domain on Cloudflare (free) and point its nameservers there, then re-run setup.',
  'setup.sshReady': '✓ passwordless SSH already set up',
  'setup.sshSetup': "→ setting up passwordless SSH to {host} (you'll enter the password once) …",
  'setup.sshHelp1': 'Server side (one-time): point a reverse proxy at the forwarded loopback port.',
  'setup.sshHelpNginx': '  nginx:  proxy_pass http://127.0.0.1:{port};  (add client_max_body_size 60m; proxy_read_timeout 90s;)',
  'setup.sshHelpCaddy': '  caddy:  {url} {  reverse_proxy 127.0.0.1:{port}  }',
  'setup.previewHelp1': 'Optional — dynamic port preview (open a dev server by port on your phone):',
  'setup.previewHelp2': '  set  "previewDomain": "..."  in the config, and route the wildcard preview domain to the gateway.',
  'setup.previewTlsCf': "  TLS: Cloudflare's free cert covers ONE level (*.example.com); deeper (*.preview.example.com) needs Advanced Certificate Manager.",
  'setup.previewTlsEdge': "  TLS: your edge serves the wildcard cert (e.g. a Let's Encrypt *.preview.your.domain).",

  // help
  'help.body': `handmux — drive your tmux from your phone

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
  --lang en|zh              CLI language (default: auto-detect from your shell locale)
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
`,
};

# Changelog

All notable changes to handmux. Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

## [0.5.1] - 2026-06-28

### Added
- **i18n: Traditional Chinese, Japanese, Korean** — three new UI locales; switch in
  Settings → Language. zh-TW browser-language detection also fixed.
- **Idea count badge** — the lightbulb topbar icon shows a count badge when there are
  pending ideas for the current window; count is also shown in the Ideas panel header.
- **Column-width fine control** — Settings now shows the live column count between the
  resize buttons, and adds ±1 buttons alongside the existing ±10 for precise adjustment.
- **SVG icons in command panel** — replaced Unicode glyphs (▤ / ★ / ☆ / ✕) with
  Lucide-style stroke SVGs consistent with the rest of the app's icon set.

### Fixed
- **tmux copy-mode blocks mobile input** — if the PC terminal was in copy/scroll mode,
  text and keys sent from the phone were silently swallowed. The server now exits
  copy-mode (`Escape`) before forwarding any input.
- **"Back to bottom" button** — appeared even when content didn't fill the screen; also
  clicking it during a momentum fling stopped the scroll without reaching the bottom.
  Both are now correct.
- **Boot flash of unstyled content** — on slow connections the boot splash could fade
  before the stylesheet arrived, briefly showing a white unstyled page. The splash now
  waits for the CSS `load` event before hiding.
- **Bind session errors when tmux has no sessions** — `list-sessions` exits non-zero
  when tmux hasn't been started; the server was propagating this as a 500. It now
  returns `[]` so the bind dialog offers to create a new session instead of erroring.

## [0.5.0] - 2026-06-28

First public release.

### Added
- `handmux` CLI: `start` / `stop` / `restart` / `status` / `logs` / `setup` / `config`,
  plus `hooks install|uninstall` and `service install|uninstall` (launchd on macOS,
  `systemd --user` on Linux). `--version` / `-v` prints the version.
- Pluggable tunnel drivers: `none` (default — local/LAN only, nothing exposed) and
  `cloudflare` (free quick tunnel; `cloudflared` is auto-downloaded if missing).
  `ssh` self-hosted tunnel is reserved (engine: `tunlite run`).
- Single supervisor process owns the server and the tunnel as children, restarts them
  with backoff, and records the live public URL into `~/.handmux/state.json`.
- Auth token is always materialised (generated when unset) and baked into the QR for
  one-tap sign-in; the printed plain links stay token-free so they're safe to share.
- Config resolution: flags > `~/.handmux/config.json` > env > defaults.
- Startup tmux check: hard error if tmux is absent, warning if it's older than the tested
  minimum (3.0) — since `capture-pane -e -N` rendering behaviour drifts across tmux versions.
- Test guard `capture-pane keeps SGR (-e) and trailing whitespace (-N)` so that drift surfaces
  as a named failure rather than a mobile-render glitch.

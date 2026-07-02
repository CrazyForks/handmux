# Changelog

All notable changes to handmux. Format follows [Keep a Changelog](https://keepachangelog.com).

## [Unreleased]

### Added
- **CLI now speaks Chinese** — the `handmux` command-line output (help, `start`/`status`/
  `setup` prompts, errors, the access block) is fully localized. Language resolves from
  `--lang en|zh`, a `"lang"` field in the config, or the shell locale (`LANG`/`LC_*` = `zh…`),
  defaulting to English. `handmux setup` now asks for the language first, and `handmux config`
  shows the resolved `lang`.
- **Take over Claude sessions running outside tmux** — the inbox now detects `claude`
  processes that aren't in a tmux pane (so handmux can't steer them) and lists them in a
  collapsible footer with each session's working dir, idle/busy state, and last message. One
  tap opens a takeover sheet: resume the session in a fresh tmux session (or a new window of
  an existing one) via `claude --resume`, optionally ending the original process (default on —
  a resumed session shares the same history file, so a single writer avoids corruption). New
  `GET /api/orphans` + `POST /api/orphans/takeover`. Detection is a process scan (ps + tmux +
  lsof), skipping Ctrl-Z-suspended and background sessions.

### Changed
- **`handmux start` on an already-running instance is clearer** — instead of a terse "already
  running — use restart", it now reassures when this run's config matches what's live, and when
  it differs (e.g. you changed `--tunnel`) it spells out the difference and offers to restart
  into it (interactive only; non-TTY just prints the `handmux restart` hint). `start` still never
  disrupts a running instance without an explicit yes.

## [0.5.3] - 2026-06-29

### Fixed
- **Git panel: bound repos reset to the default on every reopen** — repos added to a
  window were silently dropped, so reopening the panel fell back to the auto-discovered
  directory. Root cause: a legacy flat-array value under the per-window storage key made
  `readMap` return an array; subsequent writes set an array property that `JSON.stringify`
  drops, so every save vanished. `readMap` now coerces non-object values to `{}`, so
  per-window writes persist. Repos added to a window now survive close/reopen.

### Changed
- **Settings → Language label** — non-English locales now append "Language" to the setting
  label so the option is recognisable regardless of the current UI language.

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

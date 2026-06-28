// Opt-in wiring of the per-window Claude status dot into ~/.tmux.conf. The handmux hook writes a colour
// markup into each window's `@claude_dot` option on every Claude event (see hooks/handmux-write.cjs); tmux
// only RENDERS it if `window-status-format` references `#{@claude_dot}`. This module appends that display
// config PLUS the two enhancements (cold-start seed + focus-auto-clear), and — crucially — installs the
// scripts those enhancements need into a STABLE location so the wiring never breaks.
//
// Why a stable location: the scripts must be referenced by absolute path from ~/.tmux.conf. Pointing that
// at a repo checkout breaks the moment the repo moves or is renamed (the original failure: a stale
// `…/tmux-web/tmux/claude-tab-seen.sh` returned 127 on every window switch). So, exactly like the Claude
// hook copies its notify script into ~/.claude/hooks/, we copy the tmux scripts into ~/.handmux/tmux/ and
// the conf block references THAT — a path tied to $HOME, not to where handmux happens to be installed.
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pocketHome } from './state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_TMUX = path.resolve(here, '../../tmux'); // server/tmux — shipped in the package ("files": [...,"tmux"])
const SCRIPTS = ['claude-tab-seed.py', 'claude-tab-seen.sh'];

const BEGIN = '# >>> handmux claude-dot >>>';
const END = '# <<< handmux claude-dot <<<';

export function tmuxConfPath(home = homedir()) { return path.join(home, '.tmux.conf'); }

// Where the seed/seen scripts are installed — stable across repo moves / renames / a global npm install.
export function tmuxScriptsDir(home = homedir()) { return path.join(pocketHome(home), 'tmux'); }

// The marked block we append. `status-style` resets the default green status bar (which would swallow the
// green "done" dot) to neutral grey; the window-status-format lines inject `#{@claude_dot}` before the
// window name; the seed paints existing windows on (re)load; the two hooks clear a "done" dot when you
// actually focus that window. All script references use the stable ~/.handmux/tmux path (see top comment).
export function dotBlock(home = homedir()) {
  const dir = tmuxScriptsDir(home);
  const seed = path.join(dir, 'claude-tab-seed.py');
  const seen = path.join(dir, 'claude-tab-seen.sh');
  return [
    BEGIN,
    '# Per-window Claude status dot (live via the handmux hook) + cold-start seed + focus-auto-clear.',
    `# Scripts live in ${dir} (installed by handmux). Delete this whole block to disable.`,
    "set -g status-style 'bg=colour236,fg=colour250'",
    "set -g window-status-current-style 'bg=colour248,fg=colour234,bold'",
    "set -g window-status-format '#{@claude_dot}#I:#W#{?window_flags,#{window_flags}, }'",
    "set -g window-status-current-format '#{@claude_dot}#I:#W#{?window_flags,#{window_flags}, }'",
    'set -g focus-events on',
    `run-shell -b '${seed}'`,
    `set-hook -g after-select-window 'run-shell -b "${seen} #{window_id}"'`,
    `set-hook -g pane-focus-in 'run-shell -b "${seen} #{window_id}"'`,
    END,
    '',
  ].join('\n');
}

// Pure: does this ~/.tmux.conf text already wire the dot? Keys on `@claude_dot` so a user who hand-rolled
// their own is recognised as configured and never nagged or double-installed.
export function dotConfigured(text) {
  return typeof text === 'string' && text.includes('@claude_dot');
}

function readConf(home) {
  try { return fs.readFileSync(tmuxConfPath(home), 'utf8'); } catch { return null; }
}

// 'present' if the dot is already wired, else 'absent'. A missing ~/.tmux.conf is 'absent'.
export function tmuxDotStatus(home = homedir()) {
  return dotConfigured(readConf(home) || '') ? 'present' : 'absent';
}

// Copy the seed/seen scripts into the stable ~/.handmux/tmux dir (executable). Idempotent overwrite, so a
// reinstall after an upgrade refreshes them. Returns the dir. srcDir defaults to the shipped server/tmux.
export function installTmuxScripts(home = homedir(), srcDir = PKG_TMUX) {
  const dir = tmuxScriptsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of SCRIPTS) fs.copyFileSync(path.join(srcDir, f), path.join(dir, f));
  for (const f of SCRIPTS) { try { fs.chmodSync(path.join(dir, f), 0o755); } catch { /* best effort */ } }
  return dir;
}

// Install the scripts to ~/.handmux/tmux and append the marked block to ~/.tmux.conf (creating it if
// absent), idempotently. Returns { status }: 'present' if already wired (no-op), 'installed' if just added.
// Never touches the user's own lines — appends after them, separated by a newline.
export function installTmuxDot(home = homedir(), { srcDir = PKG_TMUX } = {}) {
  const existing = readConf(home);
  if (dotConfigured(existing || '')) return { status: 'present' };
  installTmuxScripts(home, srcDir);
  const prefix = existing && !existing.endsWith('\n') ? existing + '\n' : (existing || '');
  fs.writeFileSync(tmuxConfPath(home), `${prefix}\n${dotBlock(home)}`);
  return { status: 'installed' };
}

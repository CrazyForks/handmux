# handmux — born-in-tmux shim for Claude Code   (DRAFT)
#
# Why: handmux drives Claude Code by attaching to tmux panes. A `claude` started in a plain
# terminal is invisible to it, and you CANNOT reliably move a running process into tmux after the
# fact (reptyr needs Linux ptrace+/proc — out on macOS — and breaks on multithreaded Node + child
# processes). So instead of migrating, make every session *born* in tmux: this wraps `claude` so a
# session launched outside tmux is transparently relaunched inside a fresh tmux session. Already in
# tmux → it does nothing (just runs the real binary).
#
# Install: source this from your shell rc (interactive shells only):
#     # ~/.zshrc  or  ~/.bashrc
#     [ -f "$HOME/.config/handmux/claude-tmux-shim.sh" ] && . "$HOME/.config/handmux/claude-tmux-shim.sh"
# Verify:  type claude        # should show it's a shell function
#          claude             # outside tmux → lands you inside a tmux session running claude
#
# Escape hatches:
#   HANDMUX_NO_TMUX=1 claude ...      # one-off: skip the wrapper, run claude directly
#   HANDMUX_TMUX_KEEP=1               # keep the pane after claude exits (remain-on-exit), so you/
#                                     # handmux can read the final screen; default closes on exit.
#   command claude ...                # always bypasses the function (the real binary)

claude() {
  # --- pass through to the real binary (no tmux wrapping) when any of these hold ---
  #   * already inside tmux           ($TMUX set)        — nothing to do
  #   * user opted out                (HANDMUX_NO_TMUX)
  #   * tmux not installed
  #   * stdout isn't a terminal       (piped / scripted)  — wrapping would break it
  if [ -n "$TMUX" ] || [ -n "$HANDMUX_NO_TMUX" ] || ! command -v tmux >/dev/null 2>&1 || [ ! -t 1 ]; then
    command claude "$@"
    return $?
  fi

  # --- pass through print / non-interactive mode (-p/--print): one-shot output, must not be wrapped
  #     in a tmux session (it would capture the output and break piping). ---
  local a
  for a in "$@"; do
    case "$a" in
      -p|--print) command claude "$@"; return $? ;;
    esac
  done

  # --- pass through non-interactive subcommands: wrapping these in a throwaway tmux session just
  #     flashes a window for a one-shot command. First non-flag token decides. ---
  local first
  for first in "$@"; do
    case "$first" in
      -*) continue ;;   # skip leading flags to find the subcommand
    esac
    break
  done
  case "$first" in
    --version|-v|--help|-h|doctor|auth|setup-token|mcp|config|update|install|migrate-installer|remote-control)
      command claude "$@"
      return $?
      ;;
  esac

  # --- born-in-tmux: a fresh, uniquely-named session per launch so each Claude is its own pane and
  #     individually attachable from handmux. Name = cc-<cwd basename>-<rand> (handmux shows it). ---
  local base session
  base=$(basename "$PWD")
  base=${base//[^A-Za-z0-9_-]/_}                  # tmux session names can't contain '.', ':' etc.
  session="cc-${base}-${$}${RANDOM:-0}"

  # Create DETACHED first so options can be applied before claude can exit, then attach. (A blocking
  # `new-session` would only return after the session is already gone, too late to set anything.)
  # NOTE: tmux runs the command via execvp WITHOUT a shell, so this `claude` resolves on PATH to the
  # real binary — the shell function defined here never leaks into the tmux-spawned process.
  tmux new-session -d -s "$session" -n claude claude "$@" || { command claude "$@"; return $?; }

  # remain-on-exit (opt-in): keep the dead pane so the final screen survives claude exiting. Off by
  # default to avoid a pile of lingering dead panes; kill one with `tmux kill-session -t <name>`.
  [ -n "$HANDMUX_TMUX_KEEP" ] && tmux set-option -t "$session" remain-on-exit on 2>/dev/null

  tmux attach-session -t "$session"
  return $?
}

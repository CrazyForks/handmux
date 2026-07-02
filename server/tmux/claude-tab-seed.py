#!/usr/bin/env python3
# claude-tab-seed.py —— 一次性把【当前所有 Claude 窗】的状态色点写进各窗的 @claude_dot 选项。
#
# 平时这些点由 Claude hook（server/hooks/handmux-write.cjs）在状态变化那一刻事件驱动地写，不轮询、
# 不卡。但 hook 只在“有新事件”时写，所以本脚本负责冷启动填底：
#   - tmux 启动 / `source-file ~/.tmux.conf` 时由 `run-shell` 调一次；
#   - 重新部署后手动跑一次。
# 之后就交给 hook。整个机制零 `#()`、零轮询 —— 详见 tmux/README.md。
#
# 色值/分类与 hook 里的 claudeDot 保持一致；与手机端 web/src/styles.css 的 .inbox-dot 同色。

import json, os, subprocess, sys

F = os.environ.get("CLAUDE_STATE_FILE",
                   os.path.expanduser("~/.handmux/claude-state.json"))
try:
    state = json.load(open(F))
except Exception:
    sys.exit(0)

def tmux(*a):
    try:
        return subprocess.run(["tmux", *a], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return ""

def classify(e):
    s = e.get("src")
    if s == "stop": return "done"
    if s in ("prompt", "resume"): return "working"
    if s == "permreq": return "needs"
    if s == "notify" and (e.get("payload") or {}).get("notification_type") == "permission_prompt":
        return "needs"
    return None

RANK = {"needs": 3, "done": 2, "working": 1}
DOT = {
    "needs":   "#[fg=#e0a020]●#[default] ",   # 橙
    "done":    "#[fg=#2e7d46]●#[default] ",   # 绿
    "working": "#[fg=#2f6fed,blink]●#[default] ",  # 蓝闪
}

# 冷启动只给【正在跑某个 agent】的窗补点。Claude 的 pane_current_command 是 "claude";Codex 的 PATH 入口
# 是个 node 启动器,所以是 "node"(与 server 端 liveness 的 procNames 一致)。有状态条目 + 命令属于 agent
# 才补点,避免给回到 shell 的窗残留脏点。
AGENT_CMDS = {"claude", "codex", "node"}

# window_id -> 最高优先级 kind
top = {}
for line in tmux("list-panes", "-a", "-F", "#{pane_current_command} #{pane_id} #{window_id}").splitlines():
    parts = line.split()
    if len(parts) < 3 or parts[0] not in AGENT_CMDS:
        continue
    _, pane, win = parts[0], parts[1], parts[2]
    e = state.get(pane)
    if not e:
        continue
    k = classify(e)
    if not k:
        continue
    if RANK[k] > RANK.get(top.get(win, ""), 0):
        top[win] = k

# 写当前点；并清掉已不再有 claude 状态的窗的残留点
for line in tmux("list-windows", "-a", "-F", "#{window_id}").splitlines():
    win = line.strip()
    if not win:
        continue
    if win in top:
        tmux("set-option", "-w", "-t", win, "@claude_dot", DOT[top[win]])
    elif tmux("show-options", "-wv", "-t", win, "@claude_dot").strip():
        tmux("set-option", "-uw", "-t", win, "@claude_dot")

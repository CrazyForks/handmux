#!/bin/bash
# claude-tab-seen.sh <window_id> —— 你切到/聚焦某个窗时调用:若该窗当前是「已完成」绿点,清掉它
# (看过即清)。进行中(蓝)/需要你(橙)是当前态、不清。
#
# 由 ~/.tmux.conf 的 after-select-window / pane-focus-in 两个钩子触发 —— 只在你切窗、切 pane、
# 切终端这些【用户动作】时各跑一次,不在状态栏渲染路径里,所以不轮询、不卡。清绿点会写一次
# @claude_dot → 触发一次重绘,这是“状态真变了(你看过了)”，正是该重绘的时刻。
#
# 之后若 Claude 再结束一轮,hook 会重新把绿点写回来;只瞥不切则绿点保留。
W=$1
[ -n "$W" ] || exit 0
case "$(tmux show-options -wv -t "$W" @claude_dot 2>/dev/null)" in
  *2e7d46*) tmux set-option -w -t "$W" @claude_dot '' 2>/dev/null ;;   # 绿(已完成)→ 清(设空串)
esac

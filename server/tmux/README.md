# tmux 页签 Claude 状态标记（事件驱动）

给本机 tmux 的**每个 window 页签**前缀一个状态色点,SSH attach 时一眼看到哪个窗在跑、跑完了、还是在等你。**色值与手机端收件箱一致**(`web/src/styles.css` 的 `.inbox-dot`):

| 状态 | 色点 | 何时变 |
|---|---|---|
| 需要你 | 🟠 橙 `#e0a020` | 出现权限/选择弹框(`permreq` / `permission_prompt`) |
| 进行中 | 🔵 蓝 `#2f6fed` **闪** | 你发了 prompt / 答完选择(`prompt` / `resume`)。`blink` 需终端支持(iTerm2) |
| 已完成 | 🟢 绿 `#2e7d46` | Claude 结束一轮(`stop`) |
| 无 claude / 会话结束 | (无点) | `end` 清空 |

选中的窗页签用**浅灰底 + 深色粗体**(`window-status-current-style`)明显区分。

## 架构:事件驱动,不是轮询(这是重点)

```
Claude 事件 → hook(handmux-write.cjs)→ tmux set-option -w @claude_dot '#[fg=…]●'
                                          ↓
              window-status-format = '#{@claude_dot}#I:#W'  ← 纯查表,不跑任何 shell
```

- **写**:`server/hooks/handmux-write.cjs`(Claude hook,本来就在每个事件时跑、写状态文件)在末尾顺手把这次事件对应的色点 markup 写进**该 pane 所在窗**的 `@claude_dot` 选项(`set-option -w -t <pane>` 能直接定位到窗)。best-effort + 1s 超时,不在 tmux 就静默忽略,永不阻塞 Claude。
- **显示**:`~/.tmux.conf` 的 `window-status-format` 只引用 `#{@claude_dot}`(tmux 会解释里面的 `#[fg=…]` 颜色,实测真彩 hex 与手机端逐字节一致)。**格式里没有 `#()`,所以每次状态栏重绘零子进程、零开销。**
- **填底**:`tmux/claude-tab-seed.py` 一次性把当前所有 claude 窗的点按状态文件填上 —— tmux 启动 / `source-file` 时由 `~/.tmux.conf` 的 `run-shell` 调一次,重新部署后手动跑一次。之后全交给 hook。

**只有状态真变化(hook 触发那一刻)才写一次 `@claude_dot` → 才重绘一次。稳态零重绘。**

## 踩过的坑(别再走这两条死路)

这套方案是第三版,前两版把整个 tmux 拖到「整屏卡 + 光标狂闪」,根因都已实测坐实:

1. **不要在 `window-status-format` 里放 `#(脚本 …)` 主动查询。** tmux 会对【每个客户端 × 每个窗 × 每次重绘】都跑一遍脚本(spawn jq / list-panes),十几个 SSH 客户端一起跑必卡;而且 `#()` 每次返回都触发重绘 → 一直闪。**改成事件驱动:hook 推、状态栏只查表。**(隔离实测:`#{@claude_dot}` 格式空闲 3 秒输出 **0 字节**;`#()` 格式是几十~上百字节/秒不停。)
2. **不要为了存“看过/状态”在状态栏渲染路径里写 tmux 选项。** 实测**写任何 tmux 选项都会强制整条状态栏重绘**(空闲 2s 输出 0 字节,连打 12 次 `set-option` 输出 1593 字节)。在渲染路径里每帧写 = 无休止重绘 = 卡 + 光标闪。写选项只能由**低频的事件**(hook)来做,稳态绝不写。

## “已完成”绿点什么时候消失

两条途径,都不在渲染路径里、都只在你的动作那一刻各跑一次,不卡:

1. **看过即清** —— 你切到/聚焦那个窗时,`tmux/claude-tab-seen.sh` 把该窗的绿点清掉(进行中蓝、需要你橙是当前态,不清)。由两个 tmux 钩子触发:
   - `after-select-window`：会话内换 window(点页签 / prefix+数字 / next-window）。
   - `pane-focus-in`（需 `focus-events on`）：切到别的 SSH 终端、让某个窗重新获得焦点 —— 补上 after-select-window 覆盖不到的「跨终端切会话」。实测 iTerm2 等会上报焦点,此钩子能触发。
2. **接着干自然清** —— 你在该窗发下一条 prompt → `prompt` 事件 → 点变蓝(进行中)。

清掉后若 Claude 再结束一轮,hook 会重新把绿点写回来;只瞥不切、也不操作,则绿点保留(它确实还停在已完成)。

## 安装

> 需要 tmux ≥ 3.0 —— `window-status-format` 里引用用户选项 `#{@claude_dot}` 自 3.0 起才支持;更老的
> tmux 不会显示色点(会忽略或原样吐出 `#{@claude_dot}`)。

`handmux hooks install`(交互式)会把整套**自动**装好,无需手动改 conf:

1. **hook(写点)**:脚本拷进 `~/.claude/hooks/`、注册事件。每次现调,改了即生效,已在跑的 claude 无需重启。
2. **显示 + seed + 看过即清**:把 `claude-tab-seed.py` / `claude-tab-seen.sh` 拷进 **`~/.handmux/tmux/`**,并往 `~/.tmux.conf` 末尾追加下面这段**带标记的块**(引用那个稳定路径):

```tmux
# >>> handmux claude-dot >>>
set -g status-style 'bg=colour236,fg=colour250'   # 默认 bg=green 会吞掉绿点,改中性深灰
set -g window-status-current-style 'bg=colour248,fg=colour234,bold'   # 选中的窗:浅灰底+深字
set -g window-status-format '#{@claude_dot}#I:#W#{?window_flags,#{window_flags}, }'
set -g window-status-current-format '#{@claude_dot}#I:#W#{?window_flags,#{window_flags}, }'
set -g focus-events on
run-shell -b '~/.handmux/tmux/claude-tab-seed.py'
set-hook -g after-select-window 'run-shell -b "~/.handmux/tmux/claude-tab-seen.sh #{window_id}"'
set-hook -g pane-focus-in 'run-shell -b "~/.handmux/tmux/claude-tab-seen.sh #{window_id}"'
# <<< handmux claude-dot <<<
```

`tmux source-file ~/.tmux.conf` 生效。这是**共享 tmux server** 的全局设置,所有 attach 的客户端(含 PC 本机)都会一起变;手机 web 不受影响(它抓的是 pane 内容,不是状态栏)。

> 脚本走 **`~/.handmux/tmux/`**(实际写入的是展开后的绝对路径,随 `$HOME`、不随 handmux 装在哪),所以仓库搬家/改名都不会断 —— 这正是早期 `…/tmux-web/tmux/…` 写死 repo 路径后 `returned 127` 的教训。已自己手写过配置(conf 里已含 `@claude_dot`)的人会被识别为「已配置」,不会被覆盖。

## 调一调 / 卸载

- **颜色**:同时改 `handmux-write.cjs` 的 `claudeDot()` 和 `claude-tab-seed.py` 的 `DOT`(两处保持一致),hex 同手机端。
- **不想要「进行中」闪**:两处把 `,blink` 删掉。
- **卸载**:删 `~/.tmux.conf` 里 `# >>> handmux claude-dot >>>` 到 `# <<< handmux claude-dot <<<` 整段 + `tmux source-file`;清残留点 `for w in $(tmux list-windows -a -F '#{window_id}'); do tmux set-option -uw -t $w @claude_dot; done`;想彻底停止写点,直接 `handmux hooks uninstall`(移除 hook,不再写 `@claude_dot`)。

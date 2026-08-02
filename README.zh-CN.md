<p align="center"><img src="assets/readme-banner.png" alt="handmux" width="420"></p>

<p align="center">🌐 <a href="README.md">English</a> &nbsp;·&nbsp; 🇨🇳 <b>中文</b></p>

<p align="center"><a href="https://handmux.com"><b>handmux.com</b></a></p>

<p align="center">
  <a href="https://www.npmjs.com/package/handmux"><img src="https://img.shields.io/npm/v/handmux?color=cb3837&logo=npm" alt="npm"></a>
  <a href="https://github.com/handmux/handmux/actions/workflows/test.yml"><img src="https://github.com/handmux/handmux/actions/workflows/test.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="license: AGPL-3.0"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="node"></a>
</p>

> **一部手机,一整套移动 Vibe Coding 驾驶舱。** 基于 tmux——电脑上一行命令、手机扫码,你正跑着的会话、Claude Code、Codex、git、预览、文档全到手里,创造力随时随地都在你手上。

handmux 不只是把终端搬上手机。它把你电脑上**正跑着的 tmux 会话**原样搬进手机浏览器(同一个真实 pane,不是只读镜像),再围着它搭起一整套**移动 Vibe Coding 驾驶舱**:**Claude Code / Codex** 要你拍板时推到手机、拇指一点就批,动动嘴就发新指令;**git** 全屏看彩色 diff;一键**预览**正跑着的网站;**文档**逐句朗读;文件随手双向传。手机端**零安装**——点开链接就进去,"添加到主屏"即成全屏 **PWA**,和原生 App 基本无异。窝在沙发、挤在地铁,Vibe Coding 不停,创造力随时在你手里。

<p align="center">
  <img src="assets/handmux-run.gif" alt="handmux:说出需求,Claude Code 写好,点文件名即可预览结果" width="280">
  &nbsp;&nbsp;
  <img src="assets/handmux-doc.gif" alt="handmux:需要你时推送提醒,查看 git 仓库和每个 agent 的用量" width="280">
  <br>
  <em>真实手机浏览器、真实 pane——左:说出需求,Claude Code 直接写好,点文件名即可预览;右:需要你时推送提醒,查看 git 仓库与各 agent 用量。</em>
</p>

**[📖 文档](https://handmux.com/docs)** · **[🧭 路线图](ROADMAP.md#中文)** · **[📝 更新日志](CHANGELOG.md)** · **[📦 npm](https://www.npmjs.com/package/handmux)**

## 快速上手 · 约一分钟

**电脑上**需要 tmux 和 Node ≥ 20(手机只要个浏览器)。二选一:

**Homebrew —— macOS 首选** · 顺带帮你装好 Node + tmux:

```bash
brew install handmux/tap/handmux
```

**npm —— 任意平台** · 若你已经有 Node:

```bash
npm i -g handmux
```

然后跑起来:

```bash
handmux start        # 仅本机 / 同 wifi,不对外暴露
```

`start` 会打印一个**二维码**(外加地址和 token)。**手机扫它**——token 在码里,首次打开即登录。你会看到自己真实的 tmux 会话,点一个就开始操作。

想从**任何地方**都连得上?加一个参数开一条免费公网 HTTPS 链接:

```bash
handmux start --tunnel cloudflare   # 即时公网地址(自动装 cloudflared)
```

> 隧道类型、自建、Windows/WSL2、完整命令与参数 → 见 **[文档](https://handmux.com/docs)**。

## 为什么是 handmux

- **🧰 不只是终端——一整套装进口袋的移动 Vibe Coding 驾驶舱。** git 全屏看彩色 diff、一键预览正跑着的网站、文档逐句朗读、文件随手双向传——一整套开发能力,此刻全套在手,不用在几个 App 间来回切。
- **🚀 一分钟从零到手机上敲代码。** 一条 `handmux start`、扫个码,完事——不注册、不上应用商店、不装 App,一个链接就进去。"添加到主屏"后即为全屏 **PWA**,和原生 App 一样顺手。
- **🧶 人走,活不停。** 手机连的是你工位上**那一个**正跑着的 tmux pane(不是新 shell、不是截图)。合上电脑,拇指接着盯,状态一点不差。
- **🔔 需要你时,手机会响。** Claude Code / Codex 一到要你拍板就推送;添加到主屏后直接走系统通知。收件箱标「进行中 / 需要你 / 已完成」,多项目并行状态一览无余,拇指一点批授权批计划,别再守着屏幕等它。
- **🔒 你的代码,不经过任何中转。** 免费、完全开源;我们没有中转服务器,数据只在你的电脑和手机之间直接走,确保安全。

## 功能一览

- **Claude Code / Codex 深度**——收件箱状态台账、拇指批授权批计划，以及所有设备共享的本机最新 agent 用量。
- **对话视图（实验性）**——把 Claude 会话当成聊天来看、来驱动,而不是终端:气泡 + Markdown 正文、带彩色 diff 的工具卡、点按即答的问题卡、暖色配色。实验性功能,可能不稳定:在设置里开启「启用对话视图(实验性功能)」后,从窗口栏切换视图。
- **实时终端 + 电脑物理键盘直输**——手机和电脑上的终端输出都会实时出现；首次向上滑动即可查看最近的 tmux 历史，继续向上会加载更早内容，回到底部再重新同步，不会丢位置。远端 pane 比浏览器矮时，多出的区域会展示最近历史，并用一条很浅的破折线标出实时画面的起点，不再留出大片空白。离开页面会立即暂停传输；超过 10 秒后回来会直接抓取最新画面，不再补画旧输出。「实时推送」使用 WebSocket，网络较差时自动临时回退到「快照拉取」，持续稳定 30 秒后自动切回；右上角用一个标签合并显示当前模式和延迟，点击后可查看连接状态、设置模式、降级原因和恢复倒计时。也可在设置里固定使用「快照拉取」，并选择 0.8–2 秒的活跃刷新频率。电脑浏览器打开同一个 Handmux URL，无需点「展开键盘」即可直接输入当前 tmux pane；即使焦点落在 Window 工具栏，终端页面上的按键仍会继续发送给当前 pane。按 `Shift+Enter` 或点击草稿框进入草稿模式，快捷用语、上传、历史、语音和多行自动增高全部保留。`Enter` 发送后仍停留在草稿模式，`Shift+Enter` 换行，输入法合成中的 Enter 只确认候选词，按 `Esc` 或点击终端回到直通模式；有弹窗、浮窗或菜单时，`Esc` 每次只关闭最上层，连续按键可逐层返回。设置中的二级页面会保留设置父层，返回或 `Esc` 会先回到设置，再回到主屏。终端文字可直接用鼠标拖选，macOS 按 `Cmd+C` / `Cmd+V`、Windows / Linux 按 `Ctrl+Shift+C` / `Ctrl+V`（或 `Ctrl+Shift+V`）复制粘贴，`Ctrl+C` 仍是终端中断。设置里的「键盘模式」可选自动识别、手机或电脑，选择只影响当前浏览器；`Cmd+W/T/L/R`、`F5`、`F12` 等浏览器保留按键不发送到终端。
- **命令 / 聊天双模式**——底部一栏两种模式:直接敲进终端,或用自然语言发给 agent;两种默认快捷栏都有 `Ctrl+C`。`handmux shortcuts` 配置所有设备共享的按键 / 文字项;每台手机的 ⚙ 编辑器按快捷栏实际顺序统一显示共享与本机项,可自由混排,也可只从本机移除共享项并即时撤销。本机新增成功后会明确提示并直接返回列表。服务端修改立即生效,手机回到前台自动读取,无需重启或轮询。
- **更新后重新加载客户端**——服务端更新完成后，在设置里点「重新加载应用」即可载入新版客户端，无需退出主屏应用再重新打开。
- **脚本推送**——用 `handmux push` 从脚本或 CI 步骤推消息到手机,可指定全部设备、某个会话或某台设备。
- **工作区恢复**——handmux 静默保存重建最新 tmux 工作区所需的元数据。电脑或 tmux server 重启后,可从手机或 `handmux restore` 把旧工作区恢复到新会话旁边,绝不替换现有会话。
- **Git 查看器**——改动 / 提交历史 / 任意分支 / 全屏彩色 diff,多仓库分页,只读不动工作区。
- **网页预览器统一预览网址与静态目录**——网页预览器把页面嵌入 Handmux，它不是真正的浏览器，适合预览开发服务、localhost、内网和允许嵌入的网站。新页签默认手机直连；可在电脑运行 `handmux setup`、选择“网页预览器”，配置代理域名及通配路由 / TLS 后，经电脑访问其 localhost 和内网，无需对外发布。“…”菜单可用系统浏览器打开原网址、切换连接方式与手机 / 电脑视图、设置页签后台关闭时间，并按 75 / 80 / 90 / 100 / 110 / 125 / 150 / 175 / 200% 缩放。缩放保持网页原有布局，通过滚动条查看溢出内容；网页始终可交互，Handmux 的标签栏和地址栏保持固定。手机直连仍受跨域 iframe 限制，例如 `X-Frame-Options`、CSP、第三方 Cookie、标题与页面内跳转不可读，Handmux 也不一定能判断失败原因。电脑代理会转发并改写网页，即使支持 WebSocket，通常也更慢，且不保证兼容所有网站；系统不会静默切换模式。标签页、顺序、最近访问和计时只存在当前设备；只有当前标签显示关闭按钮，未选中标签的同一热区只会切换标签。同一设备的代理页签仅按真实目标 Cookie 规则共享 Cookie 以复用 SSO，不共享 localStorage、IndexedDB、Service Worker、标签或直连状态。Home 地址栏右侧的目录按钮可选择电脑用户目录下的静态目录，在同一个预览器里打开为绿色静态标签，并复用手机 / 电脑视图及保持布局的缩放。成功打开的静态目录也会进入“最近访问”，再次点击会按目录获取新 token，不保存预览地址或旧 token。静态标签不提供系统浏览器、连接方式、Cookie、后台计时、停止或重启入口；真实页面访问会自动续租，关闭标签立即释放，异常遗留的租约会在两小时后过期，重新打开已保存标签时会自动恢复。
- **文档**——终端里点路径即开;Markdown 排版、字号缩放、逐句高亮朗读。
- **选中 · 拷贝**——终端里长按选中,拖 iOS 式手柄精调,一键拷贝选区 / 整行 / 整段。
- **文件双向传**——聊天框多选上传、下载、系统分享进来、复制绝对路径。
- **想法 · 随想随记**——不错过任何点子:每窗口一份想法清单,灵感一冒就记(能语音速记),一点填进输入框。
- **专治弱网**——退避重连、掉线横幅、离线兜底页、后台暂停轮询;光标不乱跳。
- **零安装 PWA**——浏览器直接跑,可加主屏全屏运行;多语言(English、简体 / 繁體中文、日本語、한국어)。

## 工作区恢复

handmux 会持续维护最新工作区元数据的两份容灾副本。它们不是操作历史:日常变动和 handmux 能确认的主动删除只会更新当前状态。只有电脑或 tmux 环境换代时才归档可选择的 checkpoint。若最后一个 tmux 会话在 handmux 外消失，tmux 无法区分主动删除与崩溃；为保留崩溃恢复能力，handmux 会保留最后状态，并立即提供恢复，无需等待新 tmux server 或 session 出现。最近 24 小时内的全部保留;更早历史再裁到最新 10 份,最新有效 checkpoint 不会只因过期而消失。

重启后若 checkpoint 里还有内容待恢复,手机会在一小时内显示「恢复上次工作区」;若 tmux 当前没有任何会话,则直接打开确认弹窗。在手机上忽略后,该 checkpoint 只在这台手机上不再提示。恢复完成后会汇总实际恢复的会话、窗口和窗格,但不会自动打开或绑定;需要时可点「重新绑定会话」选择要显示在这台手机上的会话。手机提示过期后,CLI 仍一直可用:

```bash
handmux restore --dry-run                         # 预览最新恢复计划
handmux restore                                  # 恢复;TTY 交互选择,非 TTY 用最新
handmux restore --list                           # 列出保留的 checkpoint
handmux restore --checkpoint <id> --session api  # 选历史 / 只恢复一个会话
```

恢复是只新增、可重复执行的:不会停止、改名、替换或改变当前会话的拓扑;同名时依次改为 `name-restored`、`name-restored-2`。在安全可表达的范围内重建窗口、窗格、工作目录和布局。只有经过验证的 Claude Code / Codex 会话会用已持久化的 session ID 续接;普通 pane 只在原目录打开 shell,不会重放命令或保存的终端输出。元数据位于 `~/.handmux/workspaces/`,可能包含路径、tmux 名称/布局和 agent session ID,但不包含 pane 输出。

## 脚本推送

在电脑上运行任意脚本、CI 步骤或构建钩子时,推送通知到手机:

```bash
handmux push "构建完成" "耗时 3m12s"
```

在**你的电脑上**直接对正在运行的 `handmux` 服务器执行(回环 + 本地服务器 token——无需配置,无远端端点)。需先通过 `handmux setup` 启用 Web Push。

**语法**

```
handmux push <title> <body> [选项]
```

| 参数 | 说明 |
|---|---|
| `--session <name>` | 仅推送到订阅了该 tmux 会话的设备(可重复使用,支持逗号分隔) |
| `--device <key>` | 仅推送到指定 key 的设备(可重复使用,支持逗号分隔) |
| `--tag <T>` | 通知标签(合并同类通知) |
| `--url <U>` | 点通知后打开的 HTTP(S) URL 或站内相对路径 |

**推送范围——三选一:**

- _(默认)_ — 全部已订阅设备
- `--session` — 仅订阅了指定会话的设备
- `--device` — 仅指定 key 的设备

`--session` 与 `--device` 互斥。

**设备 key** 在手机 App 的设置 → 脚本推送中查看。它是寻址标识符,不是密钥——安全边界是本地服务器 token。

> **可靠性说明:** Web Push 属于尽力投递,不保证实时送达。有投递强要求的告警请使用专用 IM(微信、钉钉等)。

## 联网:一句话决策

默认不开隧道——手机**直连你自己的电脑**,什么都不暴露、也没有中间人。想从外面连,只问一句:**电脑有没有公网地址?**

- **有**(云主机 / 公网 IP / 已端口转发)—— 不用隧道,直接连,最快也最私密。
- **没有** —— 开一条隧道。每条都跑在**你自己的免费第三方账号**上,handmux 只负责接通、自身不设中转:`cloudflare`(零配置秒通,但公共边缘在国内常不稳)· `cloudflare-named`(你的域名,更稳)· `natapp` / `cpolar`(国内厂商,大陆境内可达)· `ssh` 自建(接你自己的服务器)。

> 隧道配置、网页预览器、开机自启、语音 / 推送凭证等细节 → 见 **[文档](https://handmux.com/docs)**。

安装开机自启后，`handmux start` / `stop` / `restart` 会始终与同一个 launchd/systemd 服务协同（升级后也一样）。生命周期锁会阻止并发启动；`status` 显示实际运行版本，并列出未登记/重复 supervisor 的 PID；`stop` 会回收全部副本。

## 环境要求

电脑需 **Node ≥ 20** 与 **tmux ≥ 3.0**;手机只要浏览器。**Windows** 请装进 **WSL2**(真 Linux 内核 + 真 tmux)——见 [文档](https://handmux.com/docs#windows)。

## 反馈与交流

遇到 bug、或者希望 handmux 多干点什么?[**发个 Issue**](https://github.com/handmux/handmux/issues)——这是真正会被跟踪处理的渠道(中英文都行)。也欢迎加入**用户微信群**,反馈直达、用法交流:

<img src="https://handmux.com/wechat-qr.png" alt="微信用户群:扫码加作者微信,备注 handmux" width="180">

## 更多

**[📖 文档](https://handmux.com/docs)** · **[🧭 路线图](ROADMAP.md#中文)** · **[📝 更新日志](CHANGELOG.md)** · **[🔒 安全](SECURITY.md)** · 许可证 **AGPL-3.0**

发现安全问题请私下报告(见 [SECURITY.md](SECURITY.md)),别开公开 issue。

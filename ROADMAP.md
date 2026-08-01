# handmux Roadmap

[English](#english) · [中文](#中文)

This roadmap describes product direction, not a fixed delivery calendar. Priorities may change with
real-world reliability findings and user feedback. Shipped behavior is documented in
[CHANGELOG.md](CHANGELOG.md).

---

## English

### Vision

handmux is becoming a **self-hosted control plane for a developer's own development environment**.

The computer remains the execution environment: tmux, shells, coding agents, repositories, development
servers, files, and credentials stay on the user's machine. handmux makes that environment understandable
and controllable from a phone, tablet, or another computer.

The long-term goal is not merely to put a terminal on a phone. It is to let a developer safely continue the
whole development loop from anywhere:

```text
notice work that needs attention
→ inspect the session and changes
→ make a decision or intervene
→ open the running result
→ verify it
→ continue or recover the work
```

### Where the product is today

handmux currently acts as a **self-hosted, tmux-native remote development cockpit**:

- it connects to the same real tmux panes used on the computer;
- it provides live terminal output, mobile and desktop input, session management, and workspace recovery;
- it brings together agent status, notifications, Git, files, documents, previews, and usage;
- it supports multiple connection paths without operating a handmux data relay.

The current phase is about making this cockpit trustworthy enough to depend on every day. The future phase
expands it from controlling running sessions to managing the projects, agents, and capabilities that make
up the entire development environment.

### Product model

The product grows around six layers:

```text
Machine
└── Project
    └── Workspace / worktree
        ├── Runtime
        │   ├── tmux sessions, windows, and panes
        │   ├── shells and development services
        │   └── connectivity and recovery
        ├── Agent sessions
        │   ├── Claude Code
        │   ├── Codex
        │   └── future agent drivers
        ├── Capability environment
        │   ├── project instructions
        │   ├── skills
        │   ├── plugins
        │   ├── MCP servers and connectors
        │   ├── hooks
        │   └── subagents
        └── Activity
            ├── running / waiting / completed
            ├── notifications and approvals
            └── changes, previews, and verification
```

| Layer | Product responsibility |
|---|---|
| Connection and runtime | Reach the machine, control the real tmux workspace, survive weak networks, and recover safely. |
| Development workspace | Inspect Git, files, documents, localhost services, and internal sites needed to verify work. |
| Agent sessions | Discover, resume, monitor, and interact with different coding agents through shared contracts. |
| Capability environment | Show what instructions, skills, plugins, MCP, hooks, and subagents are actually available and healthy. |
| Project coordination | Group work by repository/project, isolate tasks when needed, and guide review and cleanup. |
| Machine fleet | Eventually manage multiple self-hosted development machines through one optional entry point. |

### Product principles

1. **The user's machine remains the source of truth.** handmux does not move code or execution into a
   handmux cloud.
2. **Self-hosted data path by default.** Connectivity stays pluggable; operating a hosted terminal-data
   relay is not a prerequisite for using the product.
3. **tmux-native continuity.** The same live pane is more valuable than a disconnected remote copy.
4. **Agent-neutral core.** Claude Code, Codex, and future agents use adapters around shared session,
   transcript, status, capability, and recovery contracts.
5. **Complete workflows over isolated features.** A feature matters when it helps complete the
   notice → inspect → decide → verify → continue loop.
6. **Read before write.** Capability and configuration management starts with inventory and diagnostics;
   mutation comes only after scope, impact, and rollback are clear.
7. **Secrets stay secret.** handmux may report authentication health, but must not expose or synchronize
   raw credentials.
8. **Safety before automation.** Destructive changes, permission expansion, plugin installation, and
   executable recovery require explicit user control.

### Development horizons

#### Horizon 1 — A trustworthy remote workspace

**Outcome:** users can depend on handmux to reconnect to the correct development state without losing
control or being misled.

Focus:

- harden live terminal streaming, input, scrollback, weak-network fallback, background recovery, and
  mobile real-device behavior;
- make connection, notification, Service Worker, agent-hook, and workspace-recovery failures diagnosable;
- bound long-session CPU and memory usage without breaking history pagination;
- validate workspace recovery across macOS, Linux, and WSL while preserving its non-destructive guarantees;
- keep automated tests useful by removing warning noise and adding realistic lifecycle/load coverage.

This foundation remains the highest priority even while later capabilities are being developed.

#### Horizon 2 — Complete the remote development loop

**Outcome:** a developer can inspect and verify an agent's result without returning to the computer.

Focus:

- provide a built-in browser path for localhost development servers, internal systems, and normal web
  pages reachable through the development machine;
- integrate terminal links, previews, Git changes, files, and notifications into a coherent verification
  flow;
- preserve strong origin, cookie, device, and SSRF boundaries before replacing the existing dynamic
  preview path;
- finish Codex conversation-view support and move transcript/status behavior behind agent-neutral drivers;
- add a read-only Capability Center showing the effective instructions, skills, plugins, MCP connections,
  hooks, and subagents for each agent and project.

The Capability Center starts as inventory and health reporting, not as a universal package manager.

#### Horizon 3 — Manage Agents and their capability environment

**Outcome:** users can safely install and update supported coding agents, then understand, repair, and
reproduce the capabilities each agent needs for a project.

Focus:

- discover supported agents, installed versions, update channels, compatibility, and restart requirements;
- install or update supported agents through their official or native package mechanisms, with the source,
  scope, command, and impact shown before confirmation;
- diagnose load failures, missing dependencies, authentication state, scope conflicts, and reload/restart
  requirements;
- safely install, enable, disable, update, or remove skills, plugins, and MCP connections by delegating to
  each agent's native mechanisms;
- preview configuration diffs and require confirmation for permission or executable changes;
- let a project declare required capabilities and compare the declaration with the current machine;
- report configuration drift across agents or machines without exposing credentials;
- map equivalent Claude/Codex concepts while preserving provider-specific behavior instead of forcing a
  lowest-common-denominator format.

handmux should reuse existing agent marketplaces and package systems. It does not need to create a separate
handmux plugin marketplace.

#### Horizon 4 — Organize development by project and task

**Outcome:** users manage development work rather than an unstructured list of tmux sessions.

Focus:

- group work automatically and manually by repository, working directory, and worktree;
- show a project-level view of agent sessions, terminals, Git state, capabilities, previews, and attention
  required;
- allow a new task to reuse a workspace or create an isolated worktree;
- guide the review, merge, recovery, and cleanup lifecycle;
- add multi-agent coordination only where real workflows require it, rather than inventing an employee-role
  system in advance.

#### Horizon 5 — An optional multi-machine control plane

**Outcome:** one stable client can reach multiple self-hosted development machines without making a
handmux cloud the owner of their data.

Possible work:

- machine pairing and a device/machine directory;
- local, user-managed tunnel, and WebRTC transports behind one connection abstraction;
- an optional static `app.handmux.com` client and self-hostable signalling;
- synchronization of non-sensitive connection and capability metadata;
- explicit fallback paths when signalling or external infrastructure is unavailable.

This horizon requires evidence of multi-machine demand, real-network success-rate testing, and a separate
security/compliance review. It is exploration, not a current delivery commitment.

### Priority order

| Priority | Direction |
|---|---|
| **P0** | Terminal, input, reconnection, recovery, performance, diagnostics, and real-device reliability. |
| **P1** | Read-only capability inventory and health diagnostics. |
| **P1** | Built-in browser and the remote result-verification loop. |
| **P1** | Codex conversation view and agent-neutral session/transcript contracts. |
| **P2** | Safe Agent installation/upgrades, skill/plugin/MCP lifecycle management, and project capability declarations. |
| **P2** | Project grouping, project overview, and optional worktree workflows. |
| **P2** | Opt-in workspace-recovery extensions such as selected startup commands or checkpoint import/export. |
| **P3 / Explore** | Multi-machine directory, central static client, WebRTC/signalling, and advanced multi-agent coordination. |

Priorities at the same level are ordered by readiness, safety evidence, and user impact rather than by a
promised date.

### Deliberate non-goals

handmux is not currently planning to:

- become a hosted cloud development environment;
- require a handmux-operated terminal-data relay;
- replace a desktop IDE or remote-desktop product;
- build a generic web browser unrelated to development verification;
- create a competing universal plugin marketplace;
- store, display, or synchronize raw MCP/plugin credentials;
- silently install capabilities or expand agent permissions;
- automatically restore arbitrary processes, SSH state, unsaved editor buffers, or in-flight process memory.

### How roadmap decisions are made

Work moves forward when it:

1. strengthens the self-hosted, tmux-native, agent-neutral advantage;
2. completes a real development workflow instead of adding isolated surface area;
3. has a clear security and recovery boundary;
4. reuses shared contracts across agents and platforms;
5. has evidence from real devices, real networks, or repeated user demand.

Ideas and feedback are welcome in [GitHub Issues](https://github.com/handmux/handmux/issues).

---

## 中文

### 产品愿景

handmux 将发展为一个**运行在用户自己机器上的开发环境控制平面**。

电脑仍然是真正的执行环境：tmux、Shell、编程 Agent、代码仓库、开发服务、文件和凭证都留在用户自己的
机器上。handmux 负责让用户从手机、平板或另一台电脑理解和控制这套环境。

长期目标不只是把终端放进手机，而是让开发者可以在任何地方安全地继续完整开发闭环：

```text
发现需要处理的工作
→ 查看会话和代码改动
→ 做决定或介入操作
→ 打开运行结果
→ 验证结果
→ 继续或恢复工作
```

### 当前产品方向

handmux 当前是一个**自托管、以 tmux 为底座的远程开发驾驶舱**：

- 手机和电脑操作的是同一个真实 tmux pane；
- 提供实时终端、手机与电脑输入、会话管理和工作区恢复；
- 把 Agent 状态、通知、Git、文件、文档、预览和用量集中到一起；
- 支持多种连接路径，但 handmux 自身不经营终端数据中继。

当前阶段的重点，是让这套驾驶舱可靠到可以每天依赖。未来阶段则从“控制正在运行的会话”继续扩展到
“管理构成整个开发环境的项目、Agent 和能力”。

### 产品模型

产品围绕六层结构发展：

```text
机器
└── 项目
    └── 工作区 / worktree
        ├── 运行环境
        │   ├── tmux session、window、pane
        │   ├── Shell 与开发服务
        │   └── 连接与恢复
        ├── Agent 会话
        │   ├── Claude Code
        │   ├── Codex
        │   └── 未来的 Agent driver
        ├── 能力环境
        │   ├── 项目指令
        │   ├── Skills
        │   ├── Plugins
        │   ├── MCP 与 Connectors
        │   ├── Hooks
        │   └── Subagents
        └── 活动状态
            ├── 进行中 / 需要你 / 已完成
            ├── 通知与审批
            └── 改动、预览与验证
```

| 层级 | handmux 的职责 |
|---|---|
| 连接与运行 | 连接用户机器、控制真实 tmux 工作区、适应弱网并安全恢复。 |
| 开发工作区 | 查看 Git、文件、文档、localhost 服务和验证工作所需的内网站点。 |
| Agent 会话 | 通过共享契约发现、续接、监控和操作不同的编程 Agent。 |
| 能力环境 | 展示当前真正生效的指令、Skill、Plugin、MCP、Hook 和 Subagent 及其健康状态。 |
| 项目协作 | 按仓库和项目组织工作，在需要时隔离任务，并引导审查与清理。 |
| 多机器 | 最终通过一个可选入口管理多台自托管开发机器。 |

### 产品原则

1. **用户机器是真相源。** handmux 不把代码或执行迁移到 handmux 云端。
2. **默认保持自托管数据路径。** 连接方式可插拔；使用产品不应依赖 handmux 运营终端数据中继。
3. **坚持 tmux 原位连续性。** 操作同一个真实 pane，比创建一个断开的远程副本更重要。
4. **核心保持 Agent-neutral。** Claude Code、Codex 和未来 Agent 通过共享的会话、转录、状态、
   能力与恢复契约接入。
5. **完整流程优先于孤立功能。** 功能必须帮助完成“发现 → 查看 → 决策 → 验证 → 继续”闭环。
6. **先读后写。** 能力和配置管理从盘点、诊断开始，只有作用域、影响和恢复方式明确后才增加写操作。
7. **凭证永不裸露。** handmux 可以展示认证健康状态，但不能展示或同步原始凭证。
8. **安全优先于自动化。** 删除、权限扩大、Plugin 安装和可执行恢复都必须由用户明确控制。

### 发展阶段

#### 第一阶段——可信的远程工作区

**目标：** 用户可以相信 handmux 会重新连接到正确的开发状态，不丢失控制，也不会给出误导信息。

重点：

- 加固实时终端、输入、历史滚动、弱网回退、后台恢复和移动端真机行为；
- 让连接、通知、Service Worker、Agent Hook 和工作区恢复问题都可诊断；
- 限制超长会话的 CPU 与内存占用，同时保留历史分页；
- 在 macOS、Linux、WSL 上验证工作区恢复，并保持非破坏性保证；
- 清理测试警告噪声，增加更真实的生命周期和负载覆盖。

即使后续能力已经开始开发，这一基础仍保持最高优先级。

#### 第二阶段——完成远程开发闭环

**目标：** 开发者不回到电脑前，也能检查和验证 Agent 的工作结果。

重点：

- 提供内置浏览器路径，访问开发电脑上的 localhost 服务、内网系统和普通网页；
- 把终端链接、预览、Git 改动、文件和通知串成完整验证流程；
- 在替换现有动态预览前，先守住 Origin、Cookie、设备隔离和 SSRF 安全边界；
- 完成 Codex 对话视图，让转录和状态行为进入 Agent-neutral driver；
- 增加只读的“能力中心”，按 Agent 和项目展示实际生效的指令、Skill、Plugin、MCP、Hook 和
  Subagent。

能力中心首先解决盘点和健康诊断，不一开始就做通用包管理器。

#### 第三阶段——管理 Agent 及其能力环境

**目标：** 用户可以安全安装和升级受支持的编程 Agent，并理解、修复和复现每个 Agent 在项目中所需的能力。

重点：

- 发现受支持的 Agent、已安装版本、更新渠道、兼容性和重启要求；
- 通过官方或原生包管理机制安装、升级受支持的 Agent，并在确认前展示来源、作用域、命令和影响；
- 诊断加载失败、依赖缺失、认证状态、作用域冲突以及 reload/restart 要求；
- 通过各 Agent 的原生机制，安全地安装、启用、禁用、更新或移除 Skill、Plugin 和 MCP；
- 修改前展示配置 Diff，对权限或可执行能力变化进行确认；
- 允许项目声明所需能力，并与当前机器实际状态对比；
- 在不暴露凭证的前提下报告不同 Agent 或机器之间的配置漂移；
- 映射 Claude/Codex 的对应概念，同时保留各自特性，不强行压成最低公共格式。

handmux 应复用现有 Agent 生态和市场，不需要另建一套 handmux Plugin 市场。

#### 第四阶段——按项目和任务组织开发工作

**目标：** 用户管理的是开发工作，而不是一堆没有结构的 tmux 会话。

重点：

- 按仓库、工作目录和 worktree 自动或手动归类；
- 提供项目级视图，统一展示 Agent、终端、Git、能力、预览和待处理事项；
- 新任务可以复用工作区，也可以创建隔离 worktree；
- 引导审查、合并、恢复和清理流程；
- 只有真实工作流需要时才增加多 Agent 协作，不提前发明“员工角色”系统。

#### 第五阶段——可选的多机器控制平面

**目标：** 一个稳定客户端可以连接多台自托管开发机器，同时不让 handmux 云端成为数据所有者。

可能包含：

- 机器配对和设备/机器目录；
- 在统一连接抽象下支持本地直连、用户自有隧道和 WebRTC；
- 可选的 `app.handmux.com` 静态客户端及可自托管信令；
- 仅同步非敏感的连接和能力元数据；
- 信令或外部基础设施失效时提供明确回退路径。

这一阶段需要真实的多机器需求、跨网络成功率测试以及单独的安全与合规评审。目前属于探索，不是交付承诺。

### 总体优先级

| 优先级 | 方向 |
|---|---|
| **P0** | 终端、输入、重连、恢复、性能、诊断和真机可靠性。 |
| **P1** | 只读的能力盘点与健康诊断。 |
| **P1** | 内置浏览器与远程结果验证闭环。 |
| **P1** | Codex 对话视图与 Agent-neutral 会话/转录契约。 |
| **P2** | Agent 的安全安装与升级、Skill/Plugin/MCP 生命周期管理和项目能力声明。 |
| **P2** | 项目归类、项目总览和可选 worktree 工作流。 |
| **P2** | 用户明确开启的工作区恢复增强，例如启动命令、checkpoint 导入导出。 |
| **P3 / 探索** | 多机器目录、中心静态客户端、WebRTC/信令和高级多 Agent 协作。 |

同一优先级内按准备程度、安全证据和用户影响排序，不绑定承诺日期。

### 明确不做

handmux 当前不计划：

- 成为云端开发环境；
- 强制依赖 handmux 运营的终端数据中继；
- 取代桌面 IDE 或远程桌面；
- 构建与开发验证无关的通用浏览器；
- 创建另一套通用 Plugin 市场；
- 保存、展示或同步 MCP/Plugin 原始凭证；
- 静默安装能力或扩大 Agent 权限；
- 自动恢复任意进程、SSH 状态、未保存编辑器内容或运行中的进程内存。

### 如何决定 Roadmap

一项工作应满足以下条件才会向前推进：

1. 强化自托管、tmux-native、Agent-neutral 的差异；
2. 完成真实开发流程，而不是增加孤立功能面；
3. 有清晰的安全和恢复边界；
4. 能在多个 Agent 或平台间复用共享契约；
5. 有真机、真实网络或重复用户需求作为证据。

欢迎在 [GitHub Issues](https://github.com/handmux/handmux/issues) 提交想法和反馈。

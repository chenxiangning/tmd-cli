# tmd-cli 基础架构总览

- 日期：2026-09-01
- 状态：骨架已落地，持续演进
- 铁律：**模块化 + 插件化**

## 1. 产品边界

| 区域 | 第一版职责 |
|---|---|
| 头部工具栏 | 复刻 mossx 外观，预留插件挂载点 |
| 左侧栏 | 工作区 + 会话列表；会话是主入口 |
| 中央幕布 | xterm.js 透传 CLI 原生 PTY 输出，零消息/Markdown/Diff 二次渲染 |
| Composer | 富输入：截图、拖拽文件、`$` skill、`/` common、`@` 文件/文件夹 |
| 右侧栏 | 文件系统；git 与文件树并列 tab |
| 底部工具栏 | 复刻 mossx 外观，预留状态/插件挂载点 |

## 2. 分层

```
React Host
├── kernel/       插件契约、生命周期、事件总线、IPC、PTY TerminalView
├── app-shell/    五区外壳与挂载点（宿主职责）
└── plugins/      cli-omp / cli-pi / cli-codex / workspace / files / git / composer

Tauri Rust
├── pty.rs        portable-pty：spawn / read / write / resize / kill
├── session.rs    Session 元数据注册表
├── fs.rs         文件树读取
└── git.rs        git CLI shell-out
```

### 内核边界

内核只负责：窗口外壳、插件注册/激活、挂载点、PTY 生命周期、跨插件事件、IPC 边界。

插件不能直接依赖其它插件实现；通过 `PluginContext` 的 profile 注册、UI contribution 和 `EventBus` 协作。

## 3. 会话模型

```
Session = CLI profile + PTY + cwd + CLI native session id
```

一个会话固定一个 CLI，不能中途切换。恢复会话由 CLI 插件声明 `resumeArgs`，适配各 CLI 自身的会话存储和恢复机制。

## 4. Composer 输入模型

Composer 只负责富输入体验和发送编排，不实现 CLI 命令语义：

- `$`：skill；由 CLI profile 声明，不支持则不激活
- `/`：common command；由 CLI 自己解析
- `@`：文件/文件夹引用；候选来自 files 插件
- 截图/拖拽文件：落盘为会话临时文件，再按 CLI profile 规则注入
- 发送：统一进入 PTY 写入通道，使用 bracketed paste 处理多行文本

CLI 插件可以提供 `translate` 钩子处理语法差异，例如 omp/pi 的 `$skill` → `/skill:skill`；codex 原样透传。

## 5. 输出模型（硬约束）

```
PTY bytes → Tauri event pty://out/{sessionId} → xterm.js
```

中央幕布禁止额外渲染消息气泡、Markdown、Diff、token 面板。所有增强只能位于 Composer、左右侧栏、头部/底部工具栏。

## 6. 插件契约

核心接口位于 `src/kernel/plugin.ts`：

- `activate(ctx)` / `deactivate()`：生命周期
- `registerCliProfile(profile)`：CLI 插件注册启动 profile
- `contribute(point, contribution)`：向 header/footer/sidebar 扩展
- `events`：跨插件唯一通信通道

新增能力的标准路径：新增 `src/plugins/<id>/` → 实现 `Plugin` → 加入 `src/plugins/index.ts`，不修改内核。

## 7. 当前实现状态

已完成：配置脚手架、插件宿主、三 CLI profile、PTY spawn/read/write/resize/kill、Session 注册表、文件树单层懒展开、git status、xterm 幕布接线、五区外壳。

后续按优先级：mossx 外观迁移 → Composer 核心能力 → PTY bracketed-paste 发送器 → mossx git 核心子集 → CLI 交互式兼容性验证。

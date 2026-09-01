# tmd-cli

<p align="center">
  <img src="src/assets/logo.png" alt="tmd-cli logo" width="128" />
</p>

<p align="center">
  <strong>插件化的多 CLI 桌面客户端 —— 一块原生终端幕布 + 一个富输入 Composer，统一驱动 omp / pi / codex。</strong>
</p>

---

## 这是什么？

tmd-cli 是一个基于 **Tauri 2 + React + xterm.js + PTY** 的桌面应用，把多个 AI Coding CLI（`omp`、`pi`、`codex`）装进同一个窗口里。它**不重新渲染** CLI 的消息流——中央幕布通过真实 PTY 透传 CLI 原生 TUI 输出，所有增强（模型状态、文件引用、skill 触发、Git、文件树）都发生在幕布之外。

一句话：**CLI 的输出原样呈现，输入侧做富体验增强。**

## 核心设计

- **原生 PTY 幕布（硬约束）**：`PTY bytes → pty://out/{sessionId} → xterm.js`，零消息气泡 / Markdown / Diff 二次渲染。
- **插件化内核**：内核只管窗口外壳、插件生命周期、PTY 生命周期、事件总线和 IPC 边界；插件不互相依赖，通过 `PluginContext` + `EventBus` 协作。
- **会话模型**：`Session = CLI profile + PTY + cwd + CLI 原生 session id`，一个会话固定一个 CLI，恢复由各 CLI 自己的 `resume` 机制承担。
- **Composer 富输入**：
  - `$` skill（Codex 原生支持；omp/pi 自动映射为 `/skill:<name>`）
  - `/` 命令（原样透传，由 CLI 自己解析）
  - `@` 文件/文件夹引用（候选来自 files 插件）
  - 截图、拖拽文件（落盘为会话临时文件后注入）
  - bracketed paste 发送，多行文本不炸屏
- **只读状态栏**：模型 / 思考强度等状态由 CLI 插件声明的 `readSessionStatus` 适配器读取各家私有 session JSONL，内核不理解 CLI 私有格式，缺失时显示 `—`。

## 架构分层

```text
React Host
├── src/kernel/       插件契约、生命周期、事件总线、IPC、PTY TerminalView
├── src/app-shell/    五区外壳（头部 / 左栏 / 幕布 / 右栏 / 底部）与挂载点
└── src/plugins/      cli-omp · cli-pi · cli-codex · workspace · files · git · composer

Tauri Rust (src-tauri/)
├── pty.rs        portable-pty：spawn / read / write / resize / kill
├── session.rs    Session 元数据注册表
├── fs.rs         文件树读取
└── git.rs        git CLI shell-out
```

新增能力的标准路径：

- **UI / CLI 能力** → 新建 `src/plugins/<id>/`，实现 `Plugin` 接口，在 `src/plugins/index.ts` 加一行注册。
- **跨插件基础契约** → 先在 `src/kernel/` 增加稳定类型/原语，再由插件实现。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Rust，`portable-pty`） |
| 前端 | React 19 + TypeScript + Vite 7 |
| 终端 | xterm.js + addon-fit |
| 样式 | Tailwind CSS 4 |
| 图标 | lucide-react |

## 快速开始

前置：Rust toolchain、Node.js / pnpm，以及本机已安装至少一个目标 CLI（`omp` / `pi` / `codex`）。

```bash
pnpm install          # 安装依赖
pnpm tauri:dev        # 开发模式（Vite dev server + Tauri 窗口）
pnpm tauri:build      # 打包桌面应用
pnpm typecheck        # TypeScript 检查
pnpm build            # 仅构建前端产物
```

## 文档

完整设计文档见 [`docs/`](docs/README.md)：

- `docs/brainstorm/` — 需求澄清记录
- `docs/research/` — omp / pi / codex 能力矩阵（触发器、会话存储、恢复机制实测）
- `docs/architecture/` — 已落地的架构与契约

## 当前状态

骨架已落地：插件宿主、三 CLI profile、PTY 全生命周期、Session 注册表、文件树、git status、xterm 幕布接线、五区外壳、Composer 触发器 / 拖拽 / 截图、只读 session 状态栏。

进行中：bracketed-paste 发送器、git 核心子集、CLI 交互式兼容性验证。

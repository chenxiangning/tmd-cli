# tmd-cli

<p align="center">
  <img src="src/assets/logo.png" alt="tmd-cli logo" width="128" />
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
</p>

<p align="center">
  <strong>插件化的多 CLI 桌面客户端 —— 一块原生终端幕布 + 一个富输入 Composer，统一驱动 omp / pi / codex / claude / grok / kimi / qoder / qoder-cn 共 8 个 CLI。</strong>
</p>

---

## 这是什么？

tmd-cli 是一个基于 **Tauri 2 + React + xterm.js + PTY** 的桌面应用，把多个 AI Coding CLI（`omp`、`pi`、`codex`、`claude`、`grok`、`kimi`、`qoder`、`qoder-cn`）装进同一个窗口里。它**不重新渲染** CLI 的消息流——中央幕布通过真实 PTY 透传 CLI 原生 TUI 输出，所有增强（模型状态、文件引用、skill 触发、Git、文件树）都发生在幕布之外。

一句话：**CLI 的输出原样呈现，输入侧做富体验增强。**

## 核心设计

- **原生 PTY 幕布（硬约束）**：`PTY bytes → pty://out/{sessionId} → xterm.js`，零消息气泡 / Markdown / Diff 二次渲染。
- **插件化内核**：内核只管窗口外壳、插件生命周期、PTY 生命周期、事件总线和 IPC 边界；插件不互相依赖，通过 `PluginContext` + `EventBus` 协作。
- **会话模型**：`Session = CLI profile + PTY + cwd + CLI 原生 session id`，一个会话固定一个 CLI，恢复由各 CLI 自己的 `resume` 机制承担。
- **Composer 富输入**：
  - `$` skill（Codex 原生支持、原样透传；omp/pi/kimi → `/skill:<name>`、claude → `/<name>`、grok → `/skills <name>`，发送时翻译）
  - `/` 命令（原样透传，由 CLI 自己解析）
  - `@` 文件/文件夹引用（候选来自 files 插件）
  - 截图、拖拽文件（落盘为会话临时文件后注入）
  - 多行文本直发 CR 提交，bracketed-paste 发送器为进行中项
- **只读状态栏**：模型 / 思考强度等状态由 CLI 插件声明的 `readSessionStatus` 适配器读取各家私有 session JSONL，内核不理解 CLI 私有格式，缺失时显示 `—`。
- **右栏 Git 面板**：单视图三段(差异 / 分支 / 历史),外观对齐 codemoss;勾选文件 + 写消息 + 提交一次完成;commit 执行权仅在面板按钮,composer `/commit <msg>` 仅预填。契约见 `openspec/changes/git-right-panel/`。
- **审批线(checkpoints)**:AI 改动按轮成批,右栏时间线 + 中央批审阅单;整批/按文件回退、反悔恢复;影子对象库只写 blob,永不触碰用户仓库。
- **插件市场(插排)**:17 个插件可视插拔,重启生效;core 类焊死,引擎/功能可拔;CLI 品牌字形 + 语义彩色图标。

## 架构分层

```text
React Host
├── src/kernel/       插件契约、生命周期、事件总线、IPC、PTY TerminalView
├── src/app-shell/    五区外壳（头部 / 左栏 / 幕布 / 右栏 / 底部）与挂载点
└── src/plugins/      cli-* × 8(omp / pi / kimi / codex / claude / grok / qoder / qoder-cn) · session-budget · workspace · files · git · checkpoints · composer · settings · network-proxy · welcome

Tauri Rust (src-tauri/)
├── pty.rs        portable-pty：spawn / read / write / resize / kill
├── session.rs    Session 元数据注册表
├── fs.rs         文件树读取(只读) + fs_edit.rs 文件写操作
├── proxy.rs      进程级代理 env 注入
└── git/ + checkpoints/   libgit2 原语 / 审批线账本 sidecar
```

新增能力的标准路径：

- **UI / CLI 能力** → 新建 `src/plugins/<id>/`，实现 `Plugin` 接口，在 `src/plugins/index.ts` 加一行注册。
- **插件插拔** → 声明 `PluginMeta.category`(engine/feature/core),插件市场写 `settings.disabledPlugins`,重启生效。
- **跨插件基础契约** → 先在 `src/kernel/` 增加稳定类型/原语，再由插件实现。

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Rust，`portable-pty`） |
| 前端 | React 19 + TypeScript + Vite 8 |
| 终端 | xterm.js + addon-fit |
| 样式 | Tailwind CSS 4 |
| 文件编辑/预览 | CodeMirror 6 · highlight.js · react-markdown · KaTeX · Mermaid |
| 图标 | lucide-react |

## 快速开始

前置：Rust toolchain、Node.js / pnpm，以及本机已安装至少一个目标 CLI（`omp` / `pi` / `codex` / `claude` / `grok` / `kimi` / `qoder` / `qoder-cn`）。

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
- `docs/research/` — omp / pi / codex / claude / grok / kimi / qoder 能力矩阵（触发器、会话存储、恢复机制实测）
- `docs/architecture/` — 已落地的架构与契约

## 当前状态

骨架已落地:插件宿主与插件市场(17 个注册插件)、八 CLI profile(omp/pi/codex/claude/grok/kimi/qoder/qoder-cn)、PTY 全生命周期与会话输出落盘翻页、xterm 幕布、五区外壳、Composer(触发符/拖拽/截图/命令抽屉/消息锚点栏/Quota/bracketed-paste)、右栏 Git 面板全量(差异/分支/历史/远端)、文件树 + CodeMirror 编辑器 + Markdown 预览、审批线(checkpoints 账本:双归因/回退/影子对象库)、主题引擎(21 个 VS Code preset)、网络代理、只读 session 状态栏。

进行中:命令抽屉真机验收(openspec composer-command-drawer)、CLI 交互式兼容性验证;Git Graph 提案待开。

## License

本项目基于 [MIT License](LICENSE) 开源。Copyright © 2026 Chen Xiangning。


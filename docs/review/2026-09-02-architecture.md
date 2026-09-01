# 架构与插件化合规评审 — tmd-cli

- 日期：2026-09-02
- 范围：`src/kernel/**`、`src/plugins/**`、`src/app-shell/**`、`docs/architecture/**`
- 基线文档：`docs/architecture/01-overview.md`（设计决策层）、`02-code-architecture.md`（代码事实层）
- 评审方式：只读；逐条对照成文规则核验 import 事实、挂点声明/消费、kernel 模块职责

## 0. 成文架构规则提炼

| # | 规则 | 出处 |
|---|---|---|
| R1 | kernel 不 import 任何 plugins；插件清单唯一入口 `plugins/index.ts` | 01 §2 / 02 §1 |
| R2 | 插件之间零直接依赖；协作仅经 `PluginContext` / `EventBus` / kernel 注册点；`cli-shared` 是无生命周期共享格式库 | 01 §2 / 02 §1 |
| R3 | 前端触达 Rust 的唯一通道是 `kernel/ipc.ts`；插件不直接 import `@tauri-apps/api` | 02 §1「依赖铁律」 |
| R4 | 插件不得反向依赖 app-shell | 02 §1（Mounts 注释：避免插件反向依赖 app-shell） |
| R5 | UI 能力一律经 `contribute(point, …)` 挂点贡献；每个声明的 MountPoint 应由外壳 `Mounts` 消费 | 01 §6 / 02 §6 |
| R6 | 内核不得理解 CLI 私有格式（JSONL 字段、落盘命名、凭据存储） | 01 §2/§6/§7 |
| R7 | kernel 各模块职责单一：host=装配点+会话服务，events=总线，ipc=Rust 边界，plugin=契约 | 02 §7 |
| R8 | 跨模块共享类型/工具分层正确：CLI 共享格式 → `plugins/cli-shared`；通用契约/原语 → `kernel` | 01 §6 |

## 1. 核验通过项（无 finding）

- **R1 ✅** kernel 全部 import 仅指向 react / xterm / `@tauri-apps/api`（仅 ipc.ts）/ kernel 内部文件；无任何 `plugins/` 引用。
- **R2 ✅** 插件间唯一交叉引用是 `cli-omp`、`cli-pi` → `../cli-shared/*`（共享格式库，符合约定）；composer/files/workspace/settings/git 互不引用。
- **R4 ✅** `src/plugins/**` 无 `@shell` / `app-shell` 引用；composer 经 `kernel/Mounts` 渲染子挂点（Composer.tsx:151），路径正确。
- **R5（消费侧）✅** 9 个挂点有 `Mounts` 消费：header.breadcrumb/left/right、leftSidebar.section、rightSidebar.tab、editorCenter.tabContent/composer、composer.statusBar、overlay；注册侧（composer/files/settings/workspace/contributions）与之一一对应。
- **R7（大体）✅** events.ts 极简总线、ipc.ts 与 lib.rs 命令一一对应、plugin.ts 纯契约；host.ts 虽身兼注册表+会话服务+输出缓冲+状态轮询，但属文档明确定义的「装配点+会话服务」，未达上帝模块红线。
- **激活/注册纪律 ✅** quota provider、fileHighlighter/fileVisual 均在 `activate(ctx)` 内注册；`registerCliProfile` 重复即抛错；`activateAll` 有 Promise 并发闸。

## 2. Findings（按严重度排序）

### F1 [中] app-shell 直接 import `@tauri-apps/api`，绕过 IPC 唯一通道铁律（R3）

- `src/app-shell/AppShell.tsx:31` — `import { getCurrentWindow } from "@tauri-apps/api/window"`，WindowControls(:245-260) 直接调 `win.minimize()/toggleMaximize()/close()`。
- `src/app-shell/SidebarSettingsCluster.tsx:18` — `import { getVersion } from "@tauri-apps/api/app"`。

02 §1 明文：「前端触达 Rust 的唯一通道是 `src/kernel/ipc.ts`」。这两处使 ipc.ts 不再是唯一边界，未来做 IPC Mock/审计/权限收敛时会漏网。建议：在 kernel 增补 `ipc.appVersion()` 与窗口控制薄封装（或并入 `kernel/platform.ts`），外壳改走 kernel。

### F2 [中] workspace 插件直接 import `@tauri-apps/plugin-dialog`（R3）

- `src/plugins/workspace/index.tsx:26` — `import { open } from "@tauri-apps/plugin-dialog"`；:482 直接 `await open({ directory: true, … })`。

同一铁律的插件侧违例：插件应只经 `kernel/ipc.ts` 触达 Tauri。建议：ipc.ts 增加 `pickDirectory()` 封装（内部用 plugin-dialog），插件改调 ipc。

### F3 [中] `editorCenter.tabBar` 挂点声明了却无消费方，外壳硬编码 tab 栏（R5）

- 声明：`src/kernel/plugin.ts:26-27`（「中央编辑区标签页栏——文件预览/编辑器等在此开 tab」）。
- 全仓无任何 `<Mounts point="editorCenter.tabBar" />`；`src/app-shell/AppShell.tsx:143-157`（EditorCenter 内 tab-bar + FileTab）硬编码渲染 tab 栏 UI。

结果：该扩展点是死代码，插件无法替换/增强 tab 栏；同时业务 UI 固化在外壳。建议：EditorCenter 的 tab-bar-track 改为 `Mounts` 消费，默认 tab 栏下沉为 `contributions.tsx` 的可替换贡献；或删除该挂点声明。

### F4 [中] 右侧栏 git 模式与面板路由硬编码于 app-shell，git 插件无法纯靠 contribute 接入（R5/插件化）

- `src/app-shell/AppShell.tsx:377-381` — `filePanelMode === "files" ? <Mounts point="rightSidebar.tab" /> : <GitPanelPlaceholder />`。
- `src/app-shell/RightPanelToolbar.tsx` — `TopBarPanelTabs` / `OVERFLOW_TAB_IDS = ["files","git"]` 把业务面板清单写进外壳头部。

右侧栏「files/git 并列 tab」应象限为：外壳只渲染 `rightSidebar.tab` 挂点，git 面板由 git 插件贡献（git/index.tsx:4-8 目前是空 activate）。现在的结构下接入 git 面板必须改 app-shell 两处，违背「一切能力皆插件」。建议：右栏内容改由挂点 + tab id 路由（贡献自带 `tabId`），GitPanelPlaceholder 删除或下沉为 git 插件的占位贡献。

### F5 [低] kernel/filePanel.ts 枚举业务面板 id，kernel 不通用（R7/R8）

- `src/kernel/filePanel.ts:15-24` — `FilePanelMode = "files"|"git"`；`FilePanelTabId` 枚举 `search/git/projectMap/intentCanvas/radar/notes/specHub/detachedExplorer` 共 9 个产品面板名。

kernel 应是通用「右栏 tab store」，不该预知产品路线图里的业务面板清单。建议：改为通用 tab 注册表（id: string + meta），业务 id 由各自插件注册时带入。

### F6 [低] kernel/settings.ts 持有 settings 插件的面板开合 UI 状态（R7）

- `src/kernel/settings.ts:65-69` — `SettingsState.panelOpen`；`openSettingsPanel/closeSettingsPanel` 由 `app-shell/SidebarSettingsCluster.tsx:20` 直接调用。

设置面板的显隐是 settings 插件自身 UI 状态（面板由其 overlay 贡献渲染），放在内核 store 使 kernel 耦合了一个插件的 UI 生命周期。建议：panelOpen 下沉到 settings 插件内部状态，或经通用 overlay 开合原语（kernel 提供 overlay 管理，不感知「设置」语义）。

### F7 [低] kernel/diskSessions.ts 解析 omp/pi 私有落盘文件名格式（R6/R8）

- `src/kernel/diskSessions.ts:17-20` — `f.name.match(/_([0-9a-f-]{36})\.jsonl$/)`，即 omp/pi 的 `<iso-ts>_<uuid>.jsonl` 私有命名约定（cli-omp/index.tsx:30-38 的 slug 规则注释可佐证其私有性）。

01 §6：「内核不得理解 CLI 私有格式」；01 §7 把此类共享格式库定位在 `cli-shared`。该 helper 被 cli-omp/cli-pi 两个插件共用，正是 `plugins/cli-shared` 的适用场景。建议：迁移至 `plugins/cli-shared/`。

### F8 [低] Rust quota.rs 混入 omp 专用命令，与文档职责表冲突且未记录（R6）

- `src-tauri/src/quota.rs:74-92` — `omp_auth_credential` 直接读 `~/.omp/agent/agent.db` 的 `auth_credentials` 表。
- 01 §7 职责表声明 quota.rs = 「通用 HTTP 代理 + `quota_env_value` 只读环境变量」「不理解业务语义」。

JS 无法解析 sqlite，Rust 代读有现实合理性，但这是 CLI 私有存储知识进入通用后端层，且文档未承认该例外。建议：文档补记此务实例外，或将命令泛化为 `sqlite_read_kv(path, table, key)` 中性原语。

### F9 [低] PluginContext 注释「这是插件能触达的全部世界」与事实不符

- `src/kernel/plugin.ts:43`（PluginContext 文档注释）。

实际上插件绕过 ctx 直接调 kernel 注册表：`registerQuotaProvider`（cli-*/quota.ts）、`registerFileHighlighter/registerFileVisual`（files/index.tsx:215-219）、`openTab`（files/index.tsx:18）、`host` 单例（workspace/composer 多处）。两种注册风格并存（ctx.contribute vs 直接 import registry）。建议：二选一——把这些注册点收进 PluginContext，或修正注释明确「ctx 管生命周期协作，kernel 顶层导出管无状态注册表」。

### F10 [低] 02-code-architecture.md 多处与代码漂移

- :104、:240 — 文档的 `leftSidebar.sessionList` 挂点在 `plugin.ts` 中不存在；会话列表在 workspace 插件的 `leftSidebar.section` 内（workspace/index.tsx:557-561）。
- :90 — 「allPlugins (7 个)」实为 8 个（settings 已加入，plugins/index.ts:16-25）。
- :45、:304 — 「16 个 tauri::command」实为 21 个（lib.rs 18 + quota.rs 3）。
- :336 — §10「files 插件 root 硬编码为当前仓库路径」已修复：root 现跟随活跃工作区（files/index.tsx:204-209）。

文档自称「代码事实层」，漂移会误导后续评审与新人。建议按现状刷新。

## 3. 统计

- 高：0
- 中：4（F1 IPC 边界-外壳侧 / F2 IPC 边界-插件侧 / F3 tabBar 死挂点 / F4 右栏 git 硬编码）
- 低：6（F5 kernel 业务枚举 / F6 kernel 持插件 UI 态 / F7 kernel 私有格式 / F8 Rust omp 专用命令 / F9 ctx 注释失真 / F10 文档漂移）

## 4. 重点提示

无高危项。核心分层（kernel↛plugins、插件↛插件、插件↛app-shell）经 import 事实核验全部成立，属健康状态。最需优先处理的是 F1+F2（同一铁律「ipc.ts 唯一通道」的三处违例）与 F3/F4（挂点机制自身的一致性：声明了就要有消费，业务 UI 不该固化在外壳）。

# 冗余与死代码评审 — review-redundancy

- 范围: `src/**`、`src/styles/**`、`package.json`、`src-tauri/**`
- 只读评审,未修改任何文件。
- 证据口径: 每条 finding 附实际执行的搜索模式与命中数;命中数均指"除定义行外,全仓 `src/**`(含 `index.html`/`vite.config.ts`,CSS 类另含 `src-tauri` 无关)的词边界出现次数"。
- 注意: 本批次有并行测试 agent 新增了 `tabs.test.ts`/`workspace.test.ts`/`filePanel.test.ts`/`themeTokens.test.ts`/`themePresets.test.ts`/`serialize.test.ts`/`fileVisual.test.ts`/`settings.test.ts`,扫描已基于最新文件重跑;"仅测试引用"单独归类。

## 1. 零引用导出

### 1a. 完全死代码(生产/测试/文件内部均零引用)

| 文件:行号 | 严重度 | 问题 | 建议修法 | 证据 |
|---|---|---|---|---|
| src/kernel/platform.ts:35 | 中 | `isMacPlatform` 导出后无任何调用方,连本文件内部也不用 | 删除,或改为 `getPlatformKind() === "macos"` 的内部判断 | `grep -rn '\bisMacPlatform\b' src` → 仅 1 处命中(定义行本身) |
| src/kernel/platform.ts:39 | 中 | `isWindowsPlatform` 同上 | 同上 | `grep -rn '\bisWindowsPlatform\b' src` → 仅 1 处命中(定义行本身) |

### 1b. 导出冗余(仅本文件内部使用,`export` 关键字无外部消费者)

均为低严重度。证据统一为: 对符号做 `\b<name>\b` 词边界全仓搜索,除定义文件外命中 0;定义文件内部有使用(int=N 为内部引用次数)。
注意: `ipc.ts` 的接口经 `kernel/index.ts` 的 `export * from "./ipc"`  barrel 对外暴露,属公共 IPC 契约面,删 `export` 前先确认是否有意保留为公共类型。

| 符号 | 位置 | 内部引用 |
|---|---|---|
| EventHandler | src/kernel/events.ts:6 | 4 |
| FileHighlighter | src/kernel/fileHighlighter.ts:8 | 3 |
| FilePanelMode | src/kernel/filePanel.ts:15 | 3 |
| FilePanelTabMeta | src/kernel/filePanel.ts:31 | 1 |
| FileStamp | src/kernel/ipc.ts:51 | 1 |
| GitStatus | src/kernel/ipc.ts:57 | 1 |
| PlatformKind | src/kernel/platform.ts:9 | 5 |
| QuotaFetchResponse | src/kernel/ipc.ts:115 | 1 |
| QuotaFetchSpec | src/kernel/ipc.ts:108 | 1 |
| QuotaProvider | src/kernel/quota.ts:42 | 3 |
| SettingsTabContribution | src/kernel/settingsRegistry.ts:13 | 1 |
| SpawnedSession | src/kernel/ipc.ts:18 | 1 |
| TriggerKind | src/kernel/cli.ts:10 | 2 |
| VsCodeThemeColors | src/kernel/themePresets.ts:34 | 2 |
| WorkspaceMeta | src/kernel/ipc.ts:32 | 1 |
| WorkspacesFile | src/kernel/ipc.ts:39 | 2 |
| ThemeCssVariableMap | src/kernel/themeTokens.ts:13 | 1 |
| WorkspaceSubbar | src/app-shell/RightPanelToolbar.tsx:227 | 4(仅被同文件 legacy `RightPanelToolbar` 渲染) |
| extToLang | src/plugins/files/highlighter.ts:38 | 1 |
| getPlatformKind | src/kernel/platform.ts:22 | 4 |
| PiRoute | src/plugins/cli-pi/quota.ts:147 | 1 |

建议: 类型/interface 去掉 `export`(保留内部使用);`WorkspaceSubbar`/`extToLang`/`getPlatformKind` 同理,或明确作为公共 API 保留并补注释。

### 1c. 仅测试引用,无生产调用方(低,信息项)

以下符号在本批新增测试前是零引用;现被测试锁定但生产代码无人调用,需决策"保留为公共 API"还是"删测试+删代码":

| 符号 | 位置 | 唯一引用方 |
|---|---|---|
| getTabs / getActiveTabId | src/kernel/tabs.ts:74,78 | tabs.test.ts |
| getActiveWorkspace / ensureWorkspaceBooted | src/kernel/workspace.ts:110,78 | workspace.test.ts |
| getFilePanelMode / getPinnedPanelIds | src/kernel/filePanel.ts:88,92 | filePanel.test.ts |
| getContrastingTextColor | src/kernel/themeTokens.ts:54 | themeTokens.test.ts |
| translatePrompt | src/plugins/composer/serialize/serialize.ts:50 | serialize.test.ts(prepareSendPayload 内部也用) |
| ALL_THEME_PRESET_IDS / DARK_THEME_PRESET_IDS / LIGHT_THEME_PRESET_IDS | src/kernel/themePresets.ts:92,77,65 | themePresets.test.ts — ⚠️ 主题引擎正在并行开发,不判死 |
| EditorTab (type) | src/kernel/tabs.ts:16 | tabs.test.ts |
| FileVisualHint (type) | src/kernel/fileVisual.ts:11 | fileVisual.test.ts |

证据: `\b<name>\b` 全仓搜索,命中文件仅为对应 `*.test.ts`。

## 2. 死代码 / 遗留占位

### 2a. 永远只 console.info 的占位 handler(全部有"占位"注释,低严重度,集中登记)

| 文件:行号 | 严重度 | 问题 | 建议修法 |
|---|---|---|---|
| src/app-shell/RightPanelToolbar.tsx:91 | 低 | detachedExplorer 菜单项 onClick 仅 `console.info("...(placeholder)")` | 接入独立文件窗口,或先 disabled 并隐藏入口 |
| src/app-shell/RightPanelToolbar.tsx:246,258,270,282 | 低 | WorkspaceSubbar 4 个按钮(打开独立窗口/新建文件/新建文件夹/刷新)全部仅 console.info | 同上;刷新按钮可接 files 插件的 reload |
| src/app-shell/AppShell.tsx:116 | 低 | tab "在新窗口打开"按钮仅 console.info(注释自承"占位:detached file explorer 后续接入") | 同上 |
| src/plugins/files/index.tsx:159 | 低 | 文件树右键"在新窗口打开"仅 console.info | 同上 |
| src/app-shell/SidebarSettingsCluster.tsx:140-143 | 低 | `placeholder(name)` 工厂,锁屏等菜单动作仅 console.info(文件头注释已声明"六个菜单动作全部占位") | 逐个实装或裁剪菜单项 |
| src/plugins/git/index.tsx:6-9 | 低 | `gitPlugin.activate()` 空函数,注释声明"暂无 UI 贡献;保留插件位" | 有意占位,建议保留但加 issue 链接 |

证据: `grep -rn 'console\.' src --include='*.ts*'` 全量 14 条逐一人工核对;其中 `console.warn` 为真实错误路径(settings.ts:93、workspace.ts:73、Composer.tsx:107/122、workspace/index.tsx:492),不算占位。

### 2b. 不可达分支 / 注释掉的代码块 / TODO 清单

- `grep -rnE 'TODO|FIXME|XXX|HACK|if\s*\(\s*false|if\s*\(\s*0' src src-tauri/src` → **0 命中**。无 TODO/FIXME 清单可列。
- `grep -rnE '^\s*//\s*(if|for|while|return|const|let|var|function|import|export|await)' src src-tauri/src` → **0 命中**。无注释掉的代码块。

### 2c. 过期兼容字段

| 文件:行号 | 严重度 | 问题 | 建议修法 | 证据 |
|---|---|---|---|---|
| src/kernel/fileVisual.ts:16-17 | 低 | `FileVisualHint.glyph?: string` 注释自承"兼容字段…UI 不再使用",全仓无读取方 | 删除字段及注释 | `grep -rn '\.glyph\b\|glyph:' src --include='*.ts*'` → 仅注释/定义命中,无消费方 |

## 3. 重复逻辑

| 文件:行号 | 严重度 | 问题 | 建议修法 | 证据 |
|---|---|---|---|---|
| src/plugins/composer/view/QuotaChip.tsx:24 `formatRelativeTime` ↔ src/plugins/workspace/index.tsx:53 `relativeTime` | 低 | 两份中文相对时间格式化(一个未来向"N秒后",一个过去向"N 分");语义互补但阶梯逻辑同窗 | 抽 `src/kernel/` 或 cli-shared 的共享 `formatRelativeTime(diffMs)` 双向 util | `grep -rnE '相对时间\|分钟前\|小时前' src` → 两处独立实现 |
| src/kernel/workspace.ts:86 ↔ src/app-shell/RightPanelToolbar.tsx:67-70 ↔ src/app-shell/contributions.tsx:16-19 | 中 | 同一"取 workspace 路径末段当名称"逻辑 3 份,且分隔符不一致: workspace.ts 用 `split("/")`、RightPanelToolbar 用 `split(/[\/]/)`(两处都漏 `\`)、contributions 用 `split(/[\\/]/)`;Windows 路径下前两者会产出错误名称 | 收敛为一个 `deriveWorkspaceName(root)` util(放 kernel/workspace.ts),统一 `[\\/]` | `grep -rnE 'split\(/\[|filter\(Boolean\)\.pop' src` → 3 处命中如上 |
| src/app-shell/AppShell.tsx:95 ↔ src/plugins/files/index.tsx:29 | 低 | tab 标题 basename 又两份(`split(/[\\/]/).pop()` vs `split("/").pop()`,后者同样漏 `\`) | 并入同一 basename util | `grep -rn 'split(/' src --include='*.tsx'` → 见上 |
| src-tauri/src/fs.rs:24 ↔ :106 | 低 | `entry.file_name().to_string_lossy().to_string()` 在 list_dir 与 collect_into 重复 | 一行重复可不动;若再加第三处则抽 helper | `grep -n 'file_name' src-tauri/src/fs.rs` → 2 处 |

## 4. CSS 零引用类(src/styles/*.css)

验证方法: 提取 CSS 中全部 209 个类选择器,逐一在 `src/**/*.ts(x)` + `index.html` 搜索。拼接类名场景(如 `` `${platform}-desktop` ``、`` `pref-card${cond ? " is-active" : ""}` ``)已人工核对模板字符串;highlight.js 运行时注入的 `hljs-*` 不计死。

| 文件:行号 | 严重度 | 问题 | 建议修法 | 证据 |
|---|---|---|---|---|
| src/styles/titlebar.css:195-225 | 中 | `.capability-badge` / `.capability-badge-icon` / `.capability-badge-text` 零引用(疑似已删的标题栏能力徽章残留) | 删除 3 个选择器块 | `grep -rn 'capability' src index.html` → 仅 titlebar.css 自身命中 |
| src/styles/file-tree.css:35,46-142 | 中 | `.file-tree-top-zone` + `.file-tree-root-*` 共 11 个类(root-row/section/section-title/section-sep/label/actions/action)零引用;现文件树根行由 RightPanelToolbar 的 `panel-subbar-*` 承担 | 删除整块(含 is-spinning 相关 keyframes 引用需一并核对) | `grep -rn 'file-tree-root\|top-zone' src --include='*.ts*'` → 0 命中 |
| src/styles/file-tree.css:270,302 | 中 | `.file-tree-icon.is-text`、`.file-tree-name.is-dir` 零引用;文件颜色现由 `fileVisual.colorClass`(返回 `text-(--tmd-fg)` 等)承担 | 删除 2 条规则 | `grep -rn 'is-text\|is-dir' src --include='*.ts*'` → 0 命中 |
| src/styles/file-tree.css:342 | 低 | `.file-tree-action .glyph` 的 `.glyph` 后代零引用(见 2c, glyph 概念已整体废弃) | 随 glyph 字段一并清理 | `grep -rn 'class="glyph"\|className=.*glyph' src` → 0 命中 |
| src/styles/file-tree.css:378-382 | 低 | `.file-tree-name.git-a/m/d/r/u` 零引用,疑似为未实装的 git 状态染色预留(git 插件目前是空 activate) | **待人工确认**: 若 git 状态染色在 roadmap 内则保留并加注释,否则删除 | `grep -rnE 'git-[admr]' src --include='*.ts*'` → 0 命中 |

排除项(已确认存活,勿删): `hljs-*`(highlight.js 运行时注入,见 files/highlighter.ts:83)、`macos-desktop`/`windows-desktop`(AppShell.tsx:334 `` `${platform}-desktop` `` 模板生成)、以及全部 LOOSE-ONLY 拼接类(`pref-card`/`preset-card`/`segment`/`quota-chip`/`settings-*`/`workspace-card`/`workspace-row`/`wsmenu-item-refresh`/`panel-overflow-item*`/`file-tree-row*`/`file-tree-chevron`/`file-tree-icon-cell`/`traffic-lights` 等,均已在 TSX 模板字符串中逐一人眼核对命中)。

## 5. 依赖审计

- **package.json**: 9 个 dependencies + 9 个 devDependencies 全部有消费者,无未用包。
  证据: 对每个包名执行 `grep -rln 'from "<pkg>"\|"<pkg>/' src vite.config.ts index.html`;`tailwindcss` 由 `src/styles/global.css:1 @import "tailwindcss"` 消费;`@types/*`、`typescript`、`vite`、`vitest`、`@tauri-apps/cli` 为工具链。
- **src-tauri/Cargo.toml**: 8 个 crate 全部有 `use`/路径引用(parking_lot→session.rs:8/pty.rs:10;dirs→session.rs:59/quota.rs:79;reqwest→quota.rs:28;rusqlite→quota.rs:85;portable-pty→pty.rs:11;serde/serde_json→多文件;tauri-plugin-dialog→lib.rs:141)。无未用 crate。

## 汇总

| 类别 | 高 | 中 | 低 |
|---|---|---|---|
| 1a 完全死代码导出 | 0 | 2 | 0 |
| 1b 导出冗余 | 0 | 0 | 21 |
| 1c 仅测试引用 | 0 | 0 | 13(信息项) |
| 2a 占位 handler | 0 | 0 | 6 |
| 2b TODO/注释代码 | 0 | 0 | 0(零命中) |
| 2c 过期兼容字段 | 0 | 0 | 1 |
| 3 重复逻辑 | 0 | 1 | 3 |
| 4 CSS 零引用 | 0 | 3 | 2(含 1 待人工确认) |
| 5 依赖 | 0 | 0 | 0(全部有消费) |

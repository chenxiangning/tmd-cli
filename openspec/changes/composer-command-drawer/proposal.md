# Proposal: Composer 命令抽屉(profile 协议化 + MCP/插件分区 + 幕布焦点移交)

> **状态**:Implemented v0.2 · 2026-09-02 代码实装完成,待真机验收
> **验证**(2026-09-02 评审后复跑):typecheck 零错 / vitest 483 绿(含 drawerItems 9 + drawerPlugins 3 + arrowIntent 5 + 契约 5)/ arch-boundary 通过 / file-size 全绿(resolve.rs 已由当日评审拆分为 resolve/{mod,path_cache,which})
> **交互基准**:`docs/design/composer-drawer-demo.html` v2(已实现并在浏览器实测通过:开合/三模式点击/分区切换/过滤/键盘导航)
> **关联**:沿 `docs/research/cli-trigger-and-session-matrix.md` 的触发符透传原则;替换 `ComposerToolbar.tsx` 的「只读」占位

---

## Why

8 个 CLI 插件(claude / omp / pi / codex / grok / kimi / qoder / qoder-cn)的 `/` 命令与 `$` 技能集差异很大,目前用户只有敲出触发符才知道有什么可用;composer 右上角的「只读」文字是占位,无功能。

需要一个**命令抽屉**:点右上角图标滑出,集中展示当前 CLI 的命令与技能,点一下即达。核心约束:**适配逻辑不写死在 composer**——composer 只提供协议与执行机制,每个 cli 插件只声明数据与意图。这与 `src/kernel/cli.ts` 头注释的既有铁律同源:「composer 不做语义,只做补全 UI + 原文注入;translate 是唯一的例外钩子」。

附带一个输入区焦点痛点:composer 持有焦点时,幕布(PTY 终端)收不到 ↑↓——而部分 CLI 的终端里 ↑↓ 有原生语义(历史回溯 / 候选选择)。需要在 composer 空输入时按 ↑↓ 把焦点移交给幕布。

## What Changes

- **协议层**(`src/kernel/cli.ts`):`CliSuggestion` 增加可选字段 `action`("send" | "insert",缺省 insert)/ `icon`(语义图标名)/ `token`(完整 wire 文本,覆盖按触发符合成,供 MCP 引用等非标准语法)/ `group` / `order`;`CliProfile` 增加可选 `listSuggestions(kind, cwd)`(命令/技能运行时发现)与 `listMcpServers(cwd)`(MCP 服务器发现),对齐 `listSessions` 惯例。全部向后兼容,老 profile 零改动
- **composer 插件**:`ComposerToolbar` 右上「只读」→ 抽屉开关按钮(只读直接删除,不迁移);新增 `CommandDrawer` 组件(通用渲染器,**零 `profile.id` 分支**)与 `drawerItems` resolver(静态表 + 运行时发现统一收口,60s 缓存);抽屉顶部提供**分区切换按钮**(全部/命令/技能/MCP/插件,按实际有数据的分区渲染)
- **执行机制**:send = `prepareSendPayload(profile, wire)` + `ipc.sessionWrite`(translate 钩子已吃掉 wire 差异,如 omp `$think` → `/skill:think`);insert = 现成 `insertAtCursor`;**抽屉发送与用户手敲发送完全同路径,对手动输入的任何命令(含 /model)不做特殊拦截**
- **MCP / 插件分区**:MCP 数据 = per-CLI `listMcpServers`(claude 实证 `~/.claude.json` mcpServers、codex 实证 `~/.codex/config.toml [mcp_servers]`,omp/pi 现状无 mcp 键则不显示该区);插件数据 = 内核 `pluginLifecycle.listPluginStates()`(插件市场同源),点击经现成 `filePanel.setFilePanelMode(id)` 打开面板
- **8 个 cli-\* 插件**:只补声明数据(`action` / `icon` / `token` / `listMcpServers`),不强制——不改 = 该 CLI 抽屉命令/技能全 insert 模式、无 MCP 区,功能完整;codex 顺带补齐现状缺失的 suggestions 清单
- **幕布焦点移交**:`messageAnchors.ts` 的 `TerminalHandle` 增加 `focus()`(TerminalView 注册时多暴露一个方法);composer 空输入 + 无下拉 + 非 IME 时,↑↓ 移交焦点到幕布

## 决策(decision)

### D1 适配逻辑放哪:扩展 profile 协议(单一数据源)

| 选项 | 选 / 不选 | 理由 |
|---|---|---|
| **A. 扩展 `CliSuggestion` + `CliProfile.listSuggestions`** | ✅ | suggestions 已是触发符下拉的数据源,抽屉是第二个消费者;一份声明两个读者,超集兼容 |
| B. 新注册通道 `registerDrawerItems` | ❌ | 与 suggestions 形成双数据源,两处声明必然漂移 |
| C. composer 内 `switch (profile.id)` | ❌ | 即用户点名的写死;第 9 个 CLI 要改 composer |
| D. 各插件经 Mounts 往抽屉塞 UI | ❌(本期) | UI 级贡献会绕过数据协议,过滤/键盘/图标一致性全丢;若未来非 CLI 插件要进抽屉,`contribute("composer.drawer", …)` 是现成扩展位,YAGNI |

### D2 action 缺省 insert(安全兜底)

- "send" 会立即写入 PTY;缺省必须是不能产生副作用的那个
- 迁移红利:**8 个现有 profile 一行不改,抽屉即完全可用**(全 insert);逐项补 `action: "send"` 渐进点亮
- 判定规则(写进协议注释):bare 合法(无必需参数;或参数可选;或 bare 打开的交互 picker 由幕布内 TUI 接管)→ send;有必需参数 / 需要任务上下文 → insert

### D3 图标:composer 内置语义图标集 + kind glyph 兜底

profile 声明 `icon: "clear"` 等语义名,从 composer 自带的小图标集取色取形;未声明回退 `/`、`$` 通用 glyph。不做每插件 `renderIcon` JSX——8 家 × 10 命令是样板爆炸,且视觉一致性差。

### D4 运行时发现:可选 provider,声明后覆盖静态表

技能/命令可能落盘后才存在(claude 的 `~/.claude/skills` 现状就是激活后异步扫盘)。`listSuggestions(kind, cwd) => Promise<CliSuggestion[] | null>` 对齐 `listSessions` 的惯例:插件自扫磁盘,kernel 只给原语;返回 null 回退静态表;resolver 侧 60s 缓存(同 `suggest.ts` 的 `listDirCached` 纪律)。

### D5 焦点移交:`TerminalHandle.focus()`,走现成注册表

`messageAnchors.ts` 已有按会话的 `TerminalHandle` 注册表(锚点跳转在用)。加一个 `focus()` 方法(TerminalView 持有 `termRef`,一行接线),composer 经 `getTerminalHandle(sessionId)` 获取。不走事件总线——焦点是所有权语义,不是广播语义。

### D6 MCP 分区:per-CLI 声明式,token 字段承载各家语法

| 选项 | 选 / 不选 | 理由 |
|---|---|---|
| **A. `listMcpServers(cwd)` profile 字段 + `CliSuggestion.token`** | ✅ | MCP 配置真相在各 CLI 的配置文件;点击语法各家不同(codex `$mention`、claude `/mcp` 管理入口),token = profile 声明的完整 wire/插入文本,composer 零语法知识 |
| B. kernel 统一 MCP 注册表 | ❌ | 各家配置文件格式/路径完全不同,统一抽象 = kernel 学 8 家格式,违反"profile 即协议" |
| C. 不做 MCP 区,只留 /mcp 命令 | ❌ | 用户明确要 MCP 可见性;9 个服务器(claude 本机实证)在幕布里不可见 |

本机实证(2026-09-02,只读取证):claude `~/.claude.json` 全局 mcpServers 9 个 + 项目级;codex `~/.codex/config.toml` `[mcp_servers.*]`;**omp/pi 的 config.yml 现状无 mcp 键 → 不声明 `listMcpServers` 即自然不显示该区**(同一派生纪律)。点击语义由 profile 声明:codex = insert `$<name>`(mention 原生);claude = send `/mcp`(管理入口);qoder 未声明 `listMcpServers`(`/mcp-config` 以命令区候选存在,无独立 MCP 分区);omp/pi = v1 不实现。

### D7 插件分区:数据源 = 内核 `listPluginStates()`,打开 = `setFilePanelMode`

- 数据:插件市场与抽屉同源(`pluginLifecycle.listPluginStates()` 全量 × 启用态),composer 读内核注册表,零 per-CLI 代码、零硬编码清单
- 点击:已注册右栏面板的插件(git / files)走现成 `filePanel.setFilePanelMode(id)` 直接打开;其余(engine 类 cli-\*、无 UI 的)点击 = 现成 `settings.openSettingsPanel()`(section 定位不含,YAGNI)。**不开新的"插件激活"事件通道**(YAGNI;真需要时再加 topic 契约,同 `git://composer-prefill` 惯例)
- 展示范围:仅 `category: "feature"`(有可打开 UI 的);engine/core 类是引擎/焊死件,进抽屉是噪音

### D8 分区切换按钮:segmented tabs,按实际数据渲染

抽屉搜索框下方一排 chip(全部 / 命令 / 技能 / MCP / 插件),**只渲染实际有数据的分区**(qoder 无技能 → 无技能 chip;omp v1 无 MCP → 无 MCP chip);「全部」= 纵向堆叠全部分区。键盘导航(↑↓)只在可见项间移动,tab 用鼠标点击(避免快捷键表膨胀)。

## 8 个 CLI 的 action 初判清单

> ⚠️ **全部为文档 / `--help` / strings 取证的初判,未做交互式 TUI 实测**(同调研矩阵 §5 的限制)。
> 这正是 action 做成声明数据的原因:实测校准 = 改对应 profile 的一行,组件零改动。
> 分类规则见 D2。**`/model` 类已由用户拍板:一律 send**(bare 打开的模型 picker 由幕布内 TUI 接管)。

| CLI | send(点击直接发送) | insert(点击插入输入框) | 技能($) |
|---|---|---|---|
| **claude** | `/help` `/clear` `/compact`(参数可选)`/model` `/usage` `/resume`(picker) | — | 动态扫盘;insert(要任务上下文) |
| **omp** | `/help` `/clear` `/model` | — | `think` `plan` `review` → insert |
| **pi** | `/help` `/clear` | — | `think` `code` → insert |
| **codex** | `/model` `/status` `/diff` `/init` `/compact` `/review` `/permissions` `/skills`(全待实测;现状未声明 suggestions,M4 补齐) | `/mention`(必需路径) | `$` 原生 mentions;insert |
| **grok** | `/model` `/new` `/load`(picker)`/compact` `/skills` `/plugins` | — | `→ /skills <name>`,insert |
| **kimi** | `/help` `/new` `/plan` `/compact` `/usage` `/sessions`(picker)`/model` | `/title`(必需会话名) | `→ /skill:<name>`,insert |
| **qoder / qoder-cn** | `/simplify` `/quest` `/mcp-config` `/run` `/feedback` | `/loop`(必需 prompt 参数) | 无 `$` 触发符(`/name` 原生即命令,已并入命令区) |

共性:**技能默认 insert**(注入后通常要跟任务文本);**无 `$` 触发符的 CLI 抽屉自然不显示技能区**(分区由 `triggers ∩ suggestions` 派生)。

**MCP 分区数据源(本机实证)**:claude = `~/.claude.json` mcpServers(本机 9 个)+ 项目级;codex = `~/.codex/config.toml [mcp_servers.*]`;omp/pi/qoder/kimi/grok 配置现状未实证到 mcp 键 → v1 不声明 `listMcpServers`,该区不显示(待各家确认后补声明即可)。

**手动发送零拦截**:抽屉的 send 与用户手敲 `/model` 回车走完全相同的 `prepareSendPayload → sessionWrite` 路径;composer 对输入框内的任何文本(含斜杠命令)不做解析、拦截或特殊处理——透传铁律不变。

## Capabilities

### New Capabilities

- `composer-command-drawer`:命令抽屉的协议字段、分区派生、开合、send/insert 双模式执行、过滤与键盘导航、运行时发现、图标回退
- `composer-terminal-focus`:composer 空输入时 ↑↓ 向幕布的焦点移交

### Modified Capabilities

(无 —— 触发符下拉、发送翻译、附件、锚点栏行为均不变)

## Impact

- **修改**:`src/kernel/cli.ts`(协议字段)、`src/kernel/messageAnchors.ts`(TerminalHandle + focus)、`src/kernel/TerminalView.tsx`(注册 focus)、`src/plugins/composer/view/ComposerToolbar.tsx`(开关)、8 个 `src/plugins/cli-*/index.tsx`(纯数据)
- **新增**:`src/plugins/composer/view/CommandDrawer.tsx`、`src/plugins/composer/drawerItems.ts`(resolver:命令/技能/MCP/插件四区统一收口)、`src/plugins/composer/drawerIcons.tsx`(语义图标集)
- **同工作区捆绑落地(2026-09-02 评审盘点,属相邻小改,在此留痕)**:`src/kernel/composerStage.ts`(composer 四段高度 store)+ `ComposerToolbar.tsx` 高度按钮 + `src/app-shell/AppShell.tsx` setLayout 接线;`src/kernel/dropGuard.ts` + `src/main.tsx`(文件拖放守卫,放行 HTML5 drop);`AttachmentStrip.tsx` + `styles/composer-attachments.css`(附件条改版);`SuggestionList.tsx`(下拉贴输入行定位);`triggers/suggest.ts`(候选 `kind` 字段)
- **MCP 数据读取**:各 cli 插件自扫自家配置文件(复用现有 ipc.fsRead* 原语),kernel 不理解任何格式;插件分区数据 = `pluginLifecycle.listPluginStates()`,打开 = `filePanel.setFilePanelMode(id)`,均为现成内核 API
- **零 IPC 新增**:focus 走前端 TerminalHandle 注册表;send/insert 复用现有 sessionWrite
- **架构边界不破坏**:composer 插件不 import 任何 `cli-*` 插件(R1 反向同理);kernel 不感知具体 CLI;MCP/插件分区同为数据驱动
- 交互基准 demo(`docs/design/composer-drawer-demo.html`)保留,作为验收对照物(v2:已含 MCP/插件分区与切换按钮,浏览器实测通过)

## 验收(acceptance criteria)

### 自动化

- [ ] `drawerItems.test.ts`:静态/动态来源合并、null 回退、60s 缓存、按 triggers 派生分区(命令/技能)、MCP 区按 `listMcpServers` 声明派生、action 缺省 insert、token 覆盖默认合成
- [ ] `drawerPlugins.test.ts`:插件分区 = `listPluginStates()` 过滤 `category: "feature"`;点击映射 `setFilePanelMode`
- [ ] 分类数据契约单测:各 profile 声明的 `send` 项 ⊆ 该 CLI bare 合法清单(清单即上表,防手滑把带参命令标成 send)
- [ ] 焦点移交单测:空值 + 无下拉 + 非 IME → 移焦;非空/下拉开/IME 组合中 → 不移焦
- [ ] `pnpm vitest run` / `typecheck` / `check:file-size` / `check:arch-boundary` 全绿

### 手动(对照 demo v2,10 步全过)

| Step | 期望 |
|---|---|
| 1. 点右上抽屉图标 | 抽屉 260ms 滑入,图标高亮,搜索框聚焦;「只读」不再出现 |
| 2. 点 send 项(如 omp `/clear`) | 幕布收到 `/clear`,toast「已发送到幕布」,抽屉收起 |
| 3. 点 insert 项(如 `$plan`) | 输入框光标处出现 `$plan `,焦点回输入框,抽屉收起 |
| 4. 手敲 `/model` 回车 | 与抽屉 send 同路径直接发出,composer 无任何拦截/确认 |
| 5. 搜索框输入 "re" | 只剩命中项;清空恢复;切 tab 后过滤只作用于当前 tab |
| 6. ↑↓ + Enter | 键盘选中并执行;Esc 关闭 |
| 7. ⌘K | 抽屉开 ↔ 关 |
| 8. 切换按钮 | 「全部」纵向堆叠;单 tab 只显该分区;chip 按实际数据渲染(qoder 无技能/MCP chip) |
| 9. MCP 区(claude 会话) | 9 个服务器可见;点击走 profile 声明的语义(codex = `$mention` 插入,claude = `/mcp` 发送) |
| 10. 插件区点 Git | 右栏面板切到 Git(`setFilePanelMode`);空输入 ↑ 幕布聚焦且 CLI 历史可用 |

### 回归

- [ ] 触发符下拉(/ $ @)行为与候选完全不变(suggestions 消费方 1 不受影响)
- [ ] Enter 发送 / Shift+Enter 换行 / 附件 / 锚点栏不受影响
- [ ] 无活跃会话时抽屉开关置灰或点击无效(与 sendCurrent 的守卫一致)

## 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| action 初判错(把需参数命令标成 send) | 中 | 低 | 错误成本 = 改一行声明;D2 缺省 insert 兜底;分类契约单测防手滑 |
| paste burst 误判:直接发送的文本被 CLI 折叠成 `[Pasted Content]` | 低 | 中 | 调研矩阵 §5.2 已列;send 走与正常发送完全相同的 sessionWrite 路径,风险面一致 |
| composer 很矮时抽屉放不下 | 低 | 低 | 抽屉内部滚动(列表 flex-1 + overflow);demo 已验证 300px 高度可用 |
| codex 补齐的命令清单与实际版本漂移 | 中 | 低 | 候选只是 UI 提示、纯透传;错项后果 = 补全里多一条无效果建议 |

**回滚**:单 commit revert。边界 = composer 插件目录 + kernel/cli.ts 与 messageAnchors.ts 的增量字段 + 8 个 profile 的数据行。无迁移状态。

## 里程碑

| 里程碑 | 工日 | 内容 |
|---|---|---|
| M1 协议 + resolver | 0.5d | cli.ts 字段(含 token / listMcpServers)、drawerItems resolver(四区)+ 缓存 + 单测 |
| M2 抽屉 UI + 开关 + tabs | 1d | CommandDrawer、图标集、toolbar 开关、分区切换按钮、键盘/过滤(对照 demo v2) |
| M3 幕布焦点移交 | 0.5d | TerminalHandle.focus + composer 键判定 + 单测 |
| M4 数据补齐 + 校准 | 0.5d | 8 家 action/icon/token 声明、codex suggestions 补齐、claude/codex listMcpServers、交互式实测校准 |

**总计 ~2.5 工日**(纯前端 + 数据,无 Rust 改动)。

## 评审检查清单

- [ ] D1 扩展 profile 协议(不开第二注册通道)同意?
- [ ] D2 action 缺省 insert + 分类规则同意?`/model` 类一律 send 已拍板 ✅
- [ ] D3 语义图标集 + kind glyph 兜底(不做 per-CLI renderIcon)同意?
- [ ] D5 焦点移交走 TerminalHandle 注册表(不走事件总线)同意?
- [ ] D6 MCP 分区:per-CLI `listMcpServers` + token 字段(omp/pi v1 不实现 = 不显示该区)同意?
- [ ] D7 插件分区:仅 feature 类,点击 = `setFilePanelMode` / 跳插件市场,不开事件通道同意?
- [ ] D8 切换按钮:chip 按实际数据渲染、键盘导航不覆盖 tab 同意?
- [ ] 「只读」占位直接删除(不迁移到别处)已确认 ✅

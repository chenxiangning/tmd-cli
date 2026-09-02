# Proposal: Composer 命令抽屉(profile 协议化 + 幕布焦点移交)

> **状态**:Draft v0.1 · 待评审
> **交互基准**:`docs/design/composer-drawer-demo.html`(已实现并在浏览器实测通过:开合/双模式点击/过滤/键盘导航)
> **关联**:沿 `docs/research/cli-trigger-and-session-matrix.md` 的触发符透传原则;替换 `ComposerToolbar.tsx` 的「只读」占位

---

## Why

8 个 CLI 插件(claude / omp / pi / codex / grok / kimi / qoder / qoder-cn)的 `/` 命令与 `$` 技能集差异很大,目前用户只有敲出触发符才知道有什么可用;composer 右上角的「只读」文字是占位,无功能。

需要一个**命令抽屉**:点右上角图标滑出,集中展示当前 CLI 的命令与技能,点一下即达。核心约束:**适配逻辑不写死在 composer**——composer 只提供协议与执行机制,每个 cli 插件只声明数据与意图。这与 `src/kernel/cli.ts` 头注释的既有铁律同源:「composer 不做语义,只做补全 UI + 原文注入;translate 是唯一的例外钩子」。

附带一个输入区焦点痛点:composer 持有焦点时,幕布(PTY 终端)收不到 ↑↓——而部分 CLI 的终端里 ↑↓ 有原生语义(历史回溯 / 候选选择)。需要在 composer 空输入时按 ↑↓ 把焦点移交给幕布。

## What Changes

- **协议层**(`src/kernel/cli.ts`):`CliSuggestion` 增加可选字段 `action`("send" | "insert",缺省 insert)/ `icon`(语义图标名)/ `group` / `order`;`CliProfile` 增加可选 `listSuggestions(kind, cwd)` 运行时发现(对齐 `listSessions` 惯例)。全部向后兼容,老 profile 零改动
- **composer 插件**:`ComposerToolbar` 右上「只读」→ 抽屉开关按钮;新增 `CommandDrawer` 组件(通用渲染器,**零 `profile.id` 分支**)与 `drawerItems` resolver(静态表 + 运行时发现统一收口,60s 缓存)
- **执行机制**:send = `prepareSendPayload(profile, wire)` + `ipc.sessionWrite`(translate 钩子已吃掉 wire 差异,如 omp `$think` → `/skill:think`);insert = 现成 `insertAtCursor`
- **8 个 cli-\* 插件**:只补声明数据(`action` / `icon`),不强制——不改 = 该 CLI 抽屉全部 insert 模式、通用图标,功能完整;codex 顺带补齐现状缺失的 suggestions 清单
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

## 8 个 CLI 的 action 初判清单

> ⚠️ **全部为文档 / `--help` / strings 取证的初判,未做交互式 TUI 实测**(同调研矩阵 §5 的限制)。
> 这正是 action 做成声明数据的原因:实测校准 = 改对应 profile 的一行,组件零改动。
> 分类规则见 D2。

| CLI | send(点击直接发送) | insert(点击插入输入框) | 技能($) |
|---|---|---|---|
| **claude** | `/help` `/clear` `/compact`(参数可选)`/model`(picker)`/usage` `/resume`(picker) | — | 动态扫盘;insert(要任务上下文) |
| **omp** | `/help` `/clear` `/model`(picker,待实测) | — | `think` `plan` `review` → insert |
| **pi** | `/help` `/clear` | — | `think` `code` → insert |
| **codex** | `/model` `/status` `/diff` `/init` `/compact` `/review` `/permissions` `/skills`(全待实测;现状未声明 suggestions,M4 补齐) | `/mention`(必需路径) | `$` 原生 mentions;insert |
| **grok** | `/model` `/new` `/load`(picker)`/compact` `/skills` `/plugins` | — | `→ /skills <name>`,insert |
| **kimi** | `/help` `/new` `/plan` `/compact` `/usage` `/sessions`(picker)`/model`(待实测) | `/title`(必需会话名) | `→ /skill:<name>`,insert |
| **qoder / qoder-cn** | `/simplify` `/quest` `/mcp-config`(交互式)`/run` `/feedback` | `/loop`(必需 prompt 参数) | 无 `$` 触发符(`/name` 原生即命令,已并入命令区) |

共性:**技能默认 insert**(注入后通常要跟任务文本);**无 `$` 触发符的 CLI 抽屉自然不显示技能区**(分区由 `triggers ∩ suggestions` 派生)。

## Capabilities

### New Capabilities

- `composer-command-drawer`:命令抽屉的协议字段、分区派生、开合、send/insert 双模式执行、过滤与键盘导航、运行时发现、图标回退
- `composer-terminal-focus`:composer 空输入时 ↑↓ 向幕布的焦点移交

### Modified Capabilities

(无 —— 触发符下拉、发送翻译、附件、锚点栏行为均不变)

## Impact

- **修改**:`src/kernel/cli.ts`(协议字段)、`src/kernel/messageAnchors.ts`(TerminalHandle + focus)、`src/kernel/TerminalView.tsx`(注册 focus)、`src/plugins/composer/view/ComposerToolbar.tsx`(开关)、8 个 `src/plugins/cli-*/index.tsx`(纯数据)
- **新增**:`src/plugins/composer/view/CommandDrawer.tsx`、`src/plugins/composer/drawerItems.ts`(resolver)、`src/plugins/composer/drawerIcons.tsx`(语义图标集)
- **零 IPC 新增**:focus 走前端 TerminalHandle 注册表;send/insert 复用现有 sessionWrite
- **架构边界不破坏**:composer 插件不 import 任何 `cli-*` 插件(R1 反向同理);kernel 不感知具体 CLI
- 交互基准 demo(`docs/design/composer-drawer-demo.html`)保留,作为验收对照物

## 验收(acceptance criteria)

### 自动化

- [ ] `drawerItems.test.ts`:静态/动态来源合并、null 回退、60s 缓存、按 triggers 派生分区、action 缺省 insert
- [ ] 分类数据契约单测:各 profile 声明的 `send` 项 ⊆ 该 CLI bare 合法清单(清单即上表,防手滑把带参命令标成 send)
- [ ] 焦点移交单测:空值 + 无下拉 + 非 IME → 移焦;非空/下拉开/IME 组合中 → 不移焦
- [ ] `pnpm vitest run` / `typecheck` / `check:file-size` / `check:arch-boundary` 全绿

### 手动(对照 demo,8 步全过)

| Step | 期望 |
|---|---|
| 1. 点右上抽屉图标 | 抽屉 260ms 滑入,图标高亮,搜索框聚焦;「只读」不再出现 |
| 2. 点 send 项(如 omp `/clear`) | 幕布收到 `/clear`,toast「已发送到幕布」,抽屉收起 |
| 3. 点 insert 项(如 `/model`) | 输入框光标处出现 `/model `,焦点回输入框,抽屉收起 |
| 4. 搜索框输入 "re" | 只剩 resume/review 等命中项;清空恢复 |
| 5. ↑↓ + Enter | 键盘选中并执行;Esc 关闭 |
| 6. ⌘K | 抽屉开 ↔ 关 |
| 7. 切换到只有 `/` 触发符的 CLI(qoder) | 抽屉无技能区;badge 显示 qoder |
| 8. 输入框空,按 ↑ | 焦点到幕布(再按 ↑ 走 CLI 历史);输入框有字时 ↑ 仍是光标移动 |

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
| M1 协议 + resolver | 0.5d | cli.ts 字段、drawerItems resolver + 缓存 + 单测 |
| M2 抽屉 UI + 开关 | 1d | CommandDrawer、图标集、toolbar 开关、键盘/过滤(对照 demo) |
| M3 幕布焦点移交 | 0.5d | TerminalHandle.focus + composer 键判定 + 单测 |
| M4 数据补齐 + 校准 | 0.5d | 8 家 action/icon 声明、codex suggestions 补齐、交互式实测校准 |

**总计 ~2.5 工日**(纯前端 + 数据,无 Rust 改动)。

## 评审检查清单

- [ ] D1 扩展 profile 协议(不开第二注册通道)同意?
- [ ] D2 action 缺省 insert + 分类规则同意?
- [ ] D3 语义图标集 + kind glyph 兜底(不做 per-CLI renderIcon)同意?
- [ ] D5 焦点移交走 TerminalHandle 注册表(不走事件总线)同意?
- [ ] action 初判表的分类是否符合你的使用直觉?(实测校准在 M4)
- [ ] 「只读」占位直接删除(不迁移到别处)确认?

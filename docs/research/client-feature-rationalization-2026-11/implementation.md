# 客户端功能减法与合并重构:最新实施清单

- 日期:2026-11-03
- 对应调研:[代码校准重构版报告](README.md)
- 基线:当前工作树,版本 0.4.8
- 状态:待实施;本清单本身不代表任何功能代码已修改
- 执行边界:不介入发版;每批独立收口、独立回滚;不删除用户数据

## 0. 执行规则

### 0.1 优先级与依赖

- **P0**:无数据风险的入口减法,可先做。
- **P1**:方向明确,但需要生命周期、深链或配置兼容。
- **P2**:可选化或高成本能力,需先确认承接形态/使用证据。
- 任务 ID 不允许复用;完成后在复选框打勾并记录提交,不改变历史任务含义。
- 若发版改变了本清单列出的代码,先按新代码校准,不机械套用路径或行号。

### 0.2 每个代码批次的统一门禁

以下是**未来实施时的要求**,不是本次文档任务已运行的命令:

1. 前端统一跑 `pnpm check:gate`,不得用单段测试代替全链。
2. 提交收口前跑 `npx react-doctor@latest -y`,达到 100。
3. UI 行为变更必须 `pnpm tauri:dev` 打开真实窗口目检。
4. Rust 变更另跑 `cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`。
5. 遵守单文件 300 行、架构边界、i18n 三语、kernel 不含插件私有语义等仓规。
6. 提交信息使用 `type(scope): 中文一句话祈使句`;不把多个批次揉成一个大提交。

### 0.3 全局数据红线

- 不主动删除 `~/.tmd-cli/`、`~/.tmd-anim/`、`~/.magic-context/` 或用户项目内任何数据。
- “撤入口”不等于“禁用插件”;“禁用插件”也不等于“清除设置”。
- 先迁后台订阅,再撤旧装配;同一事件订阅在新旧宿主中只能有一份。
- 旧 tab kind、设置 section/tab id、命令 id、localStorage key 如需变更,必须有兼容映射。
- 老用户钉住清单不得被强制清空;提供显式“恢复精简布局”动作。

## 1. 批次总览与依赖图

| 批次 | 任务 | 目标 | 前置 |
| --- | --- | --- | --- |
| A | A-01～A-03 | 删除占位,市场/学堂降层 | 无 |
| B | B-01～B-04 | 建立生命周期新宿主与回归护栏 | A 可并行;B-01/B-02 必须先于 C-04 |
| C | C-01～C-04 | 工作台“回顾”合并 | C-01 → C-02/C-03 → C-04;B-01/B-02 → C-04 |
| D | D-01～D-04 | 处理面板、通知降层、搜索共壳 | B-03 → D-01;D-03 → D-04 |
| E | E-01～E-05 | AI 配置统一导航 | E-01 → E-02/E-03/E-04;E-05 可独立 |
| F | F-01～F-04 | 远程入口与设置导航分组 | B-04 → F-01/F-02;F-03 → F-04 |
| G | G-01～G-02 | RPC 会话命名与新建入口 | 与 C/D 可并行;G-01 → G-02 |
| H | H-01～H-05 | 非核心能力可选化与依赖清理 | H-01/H-02/H-03 需产品确认;H-05 最后 |
| I | I-01～I-02 | 使用证据评估 | 不阻塞 A～G;阻塞对应删除 |

## 2. 批次 A:无数据风险的入口减法

### A-01 删除在线市场占位

- 优先级:P0;依赖:无。
- 文件:`src/app-shell/PluginMarketPage.tsx`、相关 `pm-*` 样式、三语词典与页面测试。
- 实施:删除“在线市场 / 远程插件市场 · 建设中 / 即将上线”整块及不再使用的 Globe import、样式和文案键。
- 保留:内置插件启停、重启 dirty 状态、omp `registerMarketPanel` 二级市场、`market.local` 与本地插件管理。
- 数据兼容:无。
- 测试/验收:市场页不再有禁用“即将上线”按钮;插件插拔、重启、omp 二级市场、本地插件信任/回退可达;无死词典/死样式。
- 回滚:恢复该展示块即可,无状态或数据回滚。

### A-02 市场入口迁设置,保留完整管理宿主

- 优先级:P0;依赖:无;可在 A-01 前后独立提交。
- 文件:
  - `src/app-shell/LeftRail.tsx`:移除 market shell entry,保留 home/workspace-switch/settings。
  - `src/app-shell/AppShell.tsx`:保留 market overlay 状态和 `PluginMarketPage` 宿主。
  - `src/app-shell/shortcutCommands.ts`:保留 `shell.openMarket` 与 `Cmd+Shift+X`。
  - `src/plugins/local-loader/index.tsx`:注册“插件与扩展”设置 section。
  - `src/plugins/local-loader/ExtensionsSettingsTab.tsx`(新增):说明内置/本地插件管理,并调用 `shell.openMarket`。
  - `src/app-shell/PluginMarketPage.tsx`:继续渲染 `<Mounts point="market.local" />`。
- 实施:设置项通过 `getCommands()` 查找并运行 `shell.openMarket`;命令不可用时隐藏或禁用并说明,不直接 import app-shell。
- 数据兼容:`disabledPlugins`、本地插件登记、信任与版本库不变;不删 `market.local` 挂点。
- 测试/验收:左 rail 少 1 项;设置可打开市场;快捷键可开合;Composer“去插件市场”仍可达;本地插件 section 不消失;无 plugins → app-shell 反向 import。
- 回滚:恢复 LeftRail market entry 并移除设置入口;既有市场状态不受影响。

### A-03 学堂撤常驻入口,保留课程与指南

- 优先级:P0;依赖:无。
- 文件:
  - `src/plugins/academy/index.tsx`:移除 `leftSidebar.section` 贡献,新增无默认键位的 `academy.open` 命令。
  - `src/plugins/academy/academyStores.ts`:复用 `openWizard` / `openGuideTab`。
  - `src/plugins/welcome/`:在合适的帮助/页脚组件增加“CLI 学堂”动作,通过命令注册表调用。
  - `src/plugins/academy/academy.test.ts` 与 welcome 相关测试。
- 实施:学堂 overlay、`academy.guide` tab、引擎课程注册、进度和版本漂移提示保留;仅撤常驻课程卡。academy 禁用时不显示死帮助按钮。
- 数据兼容:课程进度存储不变。
- 测试/验收:左栏不再出现课程进度卡;欢迎页可打开学堂;指南深链、课程前置闸与禁用态正确;搜索入口位置不受影响。
- 回滚:恢复 `leftSidebar.section` 贡献即可。

## 3. 批次 B:隐藏生命周期与兼容护栏

### B-01 把会话退出自动归档迁到 workspace

- 优先级:P1;依赖:无;**必须先于 C-04**。
- 文件:
  - `src/plugins/session-board/boardExit.ts` 及现有测试:作为迁移事实源。
  - `src/plugins/workspace/sessionExitArchive.ts`(新增):承接相同纯判定与写路径。
  - `src/plugins/workspace/index.tsx`:在 activate 中订阅 `sessionExited`,合并进现有 cleanup。
  - `src/plugins/session-board/index.tsx`:同一提交中移除旧订阅,UI 暂保留。
- 实施:逐行为迁移“干净退出 + 已读 + 可归档身份”等判定,不在迁移时改写归档规则。归档正式归会话生命周期,不再依赖看板 UI 是否打开。
- 数据兼容:归档覆盖层 key、容量和恢复语义不变;不改 CLI 磁盘文件。
- 测试/验收:干净退出且已读归档;异常退出/未读/无身份不误归档;重复事件幂等;新旧订阅不存在双写;禁用看板 UI 后行为符合新责任定义。
- 回滚:同一提交恢复 session-board 订阅并移除 workspace 新订阅,避免两条同时生效。

### B-02 把 footprint 写侧装配迁到 workbench

- 优先级:P1;依赖:无;**必须先于 C-04**。
- 文件:
  - `src/plugins/footprint/rollup.ts`、`fpTab.ts`、`backfill.ts` 及测试:保持算法事实源。
  - `src/plugins/workbench/review/footprintRuntime.ts`(新增):承接 `activateRollup`、封口刷新和 features 写事件刷新。
  - `src/plugins/workbench/index.tsx`:attach 新 runtime,纳入返回 cleanup。
  - `src/plugins/footprint/index.tsx`:同一提交摘除旧三处装配,旧 UI 暂留。
- 实施:只迁订阅责任,不改 rollup 文件格式、单月单飞、补账触发、功能卡写路径或事件节流。
- 数据兼容:`footprint/YYYY-MM.json`、features 与 `.user.json` 不动;不执行全量重写。
- 测试/验收:一次封口只写一次;并发封口仍串行;跨零点归日不变;features 写入只触发刷新不重复写;补账幂等;deactivate 后无幽灵写。
- 回滚:恢复 footprint activate 装配并摘除 workbench runtime;不得同时保留两份。

### B-03 建立“处理”合并的双插件运行矩阵

- 优先级:P1;依赖:无;必须先于 D-01。
- 文件:`src/plugins/approval-inbox/store.ts`、`src/plugins/checkpoints/index.tsx`、两者现有测试;新增 `src/plugins/checkpoints/reviewRuntime.contract.test.ts`。
- 实施:先用测试固定四条原则:
  1. approval-inbox 继续拥有自己的 ask/host 订阅和 1.5s 重同步;
  2. checkpoints 继续拥有 prompt/edit/turn/exit 和 4s 磁盘事件拉取;
  3. 合 UI 不合 Ask 状态机、checkpoint 账本或历史 key;
  4. 两插件独立启停时各有可用面板,不能出现零入口或双份 boot。
- 数据兼容:`tmd.askHistory.v1`、checkpoints 账本与 states 不变。
- 测试/验收:覆盖 both enabled / only approval / only checkpoints / neither 四种组合的面板与后台责任;为 D-01 提供测试缝。
- 回滚:仅删新增测试,无生产行为变化。

### B-04 固定 SSH/WSL 远程行为基线

- 优先级:P1;依赖:无;必须先于 F-01/F-02。
- 文件:`src/plugins/ssh/index.tsx`、`state.ts`、`src/plugins/wsl/index.tsx`、`contributions.ts`、`wslCore.ts` 及现有测试。
- 实施:补/校准契约测试,记录模块加载重接线、SFTP 事件、会话退出清理、远程编辑关闭闸、WSL 四类注册和 UNC 元数据迁移。此任务只做护栏,不改入口。
- 数据兼容:主机、凭据、known_hosts、工作区 wsl 元数据不变。
- 测试/验收:后续 IA 改动有可比基线;任何“只保留卡片”的实现都无法通过这些测试。
- 回滚:删除新增测试,无生产行为变化。

## 4. 批次 C:工作台“回顾”合并

### C-01 把 journal 主 tab 扩成“回顾”,不减少工作台主域

- 优先级:P1;依赖:B-02 可先并行;C-02/C-03 的前置。
- 文件:
  - `src/plugins/workbench/wbTabs.ts`:保留 `journal` id,显示名改“回顾”;主 tab 仍 5 个。
  - `src/plugins/workbench/WbScreen.tsx`:journal 渲染新 `ReviewTab`。
  - `src/plugins/workbench/review/ReviewTab.tsx`、`reviewTabs.ts`(新增):二级视图 `journal / footprint / sessions`。
  - `src/plugins/workbench/journal/JournalTab.tsx`:作为默认二级视图复用。
- 实施:overview、focus、board、docs 原样保留;不合并 overview + focus。二级视图状态与日期 payload 由 `reviewTabs.ts` 统一处理。
- 数据兼容:保留 `journal` id 和既有视图偏好;新二级视图偏好使用独立 key,不覆盖旧 journal 状态。
- 测试/验收:主 tab 数=5;原工作日志年/月/轴、文章、便签、生成状态不变;切主 tab 后 keepAlive 与滚动/草稿不丢。
- 回滚:WbScreen 恢复直接渲染 JournalTab,显示名改回;无数据回滚。

### C-02 将每日足迹纳入“回顾”并保留日期深链

- 优先级:P1;依赖:C-01、B-02。
- 文件:
  - `src/plugins/footprint/`:视图、query、rollup、backfill、userLayer 与测试逐步迁入 `src/plugins/workbench/review/footprint/`。
  - `src/plugins/workbench/review/ReviewTab.tsx`:挂载 footprint 二级视图。
  - `src/plugins/workbench/review/reviewTabs.ts`:提供 `openWorkbenchReviewTab({view:"footprint",day})`。
  - `src/plugins/workbench/journal/FlowView.tsx`:把“足迹 ↗”改到新深链。
  - `src/plugins/footprint/fpTab.ts`:迁移期保留兼容封装,旧 `openFootprintTab({day})` 转发新宿主。
- 实施:先移动读侧/视图,再移动数据模块;所有存储路径保持原样。旧 `footprint.daily` kind 由 workbench 注册兼容渲染或重定向,不能成为未知 tab。
- 数据兼容:rollup/features/user layer 零迁移;日报文章 kind `daily-article` 与 autoEdit/脏稿闸不动。
- 测试/验收:journal → 足迹、足迹 → 日报双向跳日;`refresh` 换日、非法日期回落、区间选择、⌘K 反查、证据 diff、AI 补归纳、修正层均不回归。
- 回滚:恢复旧 footprint tab 注册和 FlowView 深链;新宿主不产生新数据,可直接撤回。

### C-03 将会话看板纳入“回顾 / 会话活动”

- 优先级:P1;依赖:C-01、B-01。
- 文件:
  - `src/plugins/session-board/BoardOverlay.tsx`、`BoardTab.tsx`、`DayPanel.tsx`、`CalendarGrid.tsx`、`SwimTimeline.tsx` 与数据模块。
  - `src/plugins/workbench/review/session-board/`(新目标目录):承接可嵌入视图与测试。
  - `src/plugins/workbench/review/ReviewTab.tsx`:新增“会话活动”二级视图。
  - `src/plugins/session-board/index.tsx`:迁移期左 rail 动作改为打开新回顾视图,或暂留至 C-04 统一撤。
- 实施:复用看板扫描、热力、日泳道、未读/归档导航和错误重试;把全屏 overlay 外壳与内容解耦,不在工作台里再套一层全屏遮罩。
- 数据兼容:boardData 复用会话扫描;自动归档已在 B-01 迁出,本任务不得再订阅 sessionExited。
- 测试/验收:日期筛选、会话打开/转录、未读治理、重命名、扫描失败重试、渲染预算不回归;无重复归档副作用。
- 回滚:恢复原 BoardOverlay 与左 rail 动作;无新增持久数据。

### C-04 撤旧回顾入口与退役旧插件装配

- 优先级:P1;依赖:B-01、B-02、C-02、C-03 全部验收。
- 文件:`src/plugins/index.ts`、`src/app-shell/LeftRail.tsx` 相关注册消费、旧 `src/plugins/session-board/`、旧 `src/plugins/footprint/`、图标装饰、词典和 `src/plugins/tabContent.contract.test.ts`。
- 实施:删除 session-board/footprint 左 rail 与旧插件注册;确认 workbench 已承担旧 kind、写侧和视图。若保留兼容模块,放到 workbench 明确命名,不留“幽灵插件目录”。
- 数据兼容:只删代码,不删 footprint 数据;`disabledPlugins` 中旧 id 可由通用未知 id 清洗忽略,不影响其他设置。
- 测试/验收:左 rail 目标项减少;全仓无旧 activateRollup/boardExit 双份;旧深链可用;无死命令、词典、样式、图标键和 import。
- 回滚:整批恢复旧插件注册和目录;因数据格式未变,可直接读回原数据。

## 5. 批次 D:处理面板、通知降层与搜索共壳

### D-01 合并 Ask 与 checkpoints 为“处理”,保留独立启停语义

- 优先级:P1;依赖:B-03。
- 文件:
  - `src/plugins/checkpoints/ReviewPanel.tsx`(新增):组合 Ask 视图与现有 `CheckpointsPanel`。
  - `src/plugins/checkpoints/index.tsx`:保留所有后台装配,面板 label 改“处理”。
  - `src/plugins/checkpoints/CheckpointsPanel.tsx`:保留批次/时间线/变更内部视图,可作为“变更”域嵌入。
  - `src/plugins/approval-inbox/index.tsx`:保留 boot;仅在 checkpoints 不可用时注册 Ask 独立 fallback 面板。
  - `src/plugins/approval-inbox/panel.tsx`、`store.ts`:复用,不重写作答与历史。
- 实施:
  - 两插件都启用:只显示 checkpoints 注册的“处理”宿主,内含“等待 / 变更”;不显示第二个 approval-inbox rail 项。
  - 仅 approval 启用:显示原 Ask fallback 面板。
  - 仅 checkpoints 启用:显示变更,不渲染 Ask,也不启动 approval boot。
  - 两者禁用:无面板、无后台订阅。
- 数据兼容:Ask 历史 key、通知流水、checkpoint 路径均不变;通知中心不并入。
- 测试/验收:四种启停组合;Ask 直达/文本/键序/失败横幅;1.5s 单实例重同步;checkpoint 单实例 4s 拉取;回退/应用/反悔/总览/互跳不回归。
- 回滚:恢复两个独立 filePanel 注册;后台责任始终未迁,可直接回滚 UI。

### D-02 通知中心独立保留并默认不钉

- 优先级:P0;依赖:无。
- 文件:`src/plugins/notify/index.tsx`、`src/kernel/filePanel.ts` 测试、通知面板测试。
- 实施:`notify-center` 设置 `pinnedByDefault:false`;不合并到“处理”。保留 notify 全部事件、流水、声音、免打扰、quota poll 和深链。
- 数据兼容:已有 `tmd.filePanel.pinned.v1` 不强制改;新装默认不钉。`notify-log.json` 不动。
- 测试/验收:新装通知在溢出菜单;激活时临时外显;老用户已钉状态保持;OS/声音/历史记录/回跳不变。
- 回滚:恢复默认钉住声明,无数据回滚。

### D-03 搜索共壳,保留三命令和独立插件降级路径

- 优先级:P1;依赖:无。
- 文件:
  - `src/plugins/search/overlayStore.ts`:kind 扩为 `panel / quickOpen / sessions`。
  - `src/plugins/search/index.tsx`:统一遮罩、Esc、焦点圈闭、作用域容器和结果反馈。
  - `src/plugins/search/SearchPanel.tsx`、`QuickOpen.tsx`:保留各自查询行为。
  - `src/plugins/session-search/SearchOverlay.tsx`:抽出无 portal 的会话结果本体,保留旧壳作 search 禁用时的 fallback。
  - `src/plugins/session-search/index.tsx`:search 可用时命令打开统一壳,否则使用原壳。
  - `src/plugins/search/HubEntry.tsx`:继续三项命令,不增加第二个左栏入口。
- 实施:统一壳不等于统一查询;全文仍回车触发,快开/会话仍即时检索。session-search 禁用时对应命令/作用域不可用,不能偷偷启用其索引。
- 数据兼容:会话索引缓存可重建,无用户数据迁移;保留 `tmd.search.entryCollapsed`。
- 测试/验收:任何启停组合只出现一个可用浮层;无双遮罩/双焦点圈闭;索引扫描在关壳/切作用域时取消;快捷键和命令标题不变。
- 回滚:恢复 search 两 kind 与 session-search 原 overlay;无持久状态变更。

### D-04 搜索行为与跳转回归收口

- 优先级:P1;依赖:D-03。
- 文件:`src/plugins/search/*.test.*`、`src/plugins/session-search/*.test.*`、`src/plugins/composer/` 输入历史相关测试。
- 实施:补齐三作用域端到端契约,不只测“壳能开”。
- 验收矩阵:
  - 全文:大小写、glob、2000 上限、分组、文件行跳转;
  - 快开:fuzzy、5000 walk/50 show、目录排除、截断提示;
  - 会话:多词 AND、时间/引擎/本区/全区、失效区、行级定位、打开未命中提示;
  - 通用:IME、↑↓/Enter、Esc、遮罩、焦点恢复、无工作区;
  - Composer `Cmd+L` 输入历史仍独立,可过滤并回填不直发。
- 回滚:随 D-03 一起回滚,无数据回滚。

## 6. 批次 E:AI 配置统一入口

### E-01 以现有“AI配置管理”为统一落地入口

- 优先级:P1;依赖:无。
- 文件:
  - `src/plugins/memory-coordinator/panel/MemoryFilesPanel.tsx`:保留原生记忆文件/规则体检,并增加 AI 配置导航。
  - `src/plugins/memory-coordinator/panel/AiConfigHome.tsx`(新增):引擎、Skills、MCP、Magic Context、记忆与规则、智能体/提示词入口。
  - `src/plugins/skill-hub/hubTab.ts`、`src/plugins/mcp-hub/hubTab.ts`:复用现有 open 封装。
  - `src/plugins/cli-config/index.tsx`、`src/plugins/assets/index.tsx`:复用设置深链目标。
- 实施:入口打开现有中央 tab或设置 section,不复制管理表单、不新建总配置库。各能力按插件启用状态显示/禁用并解释。
- 数据兼容:不写任何配置;Magic Context、Skills、MCP、assets 存储不变。
- 测试/验收:六类入口都能到达真实管理面;返回后右栏状态不丢;禁用某插件无死按钮;原生记忆文件和 lint 仍可直达。
- 回滚:移除导航卡,恢复原 MemoryFilesPanel;无数据回滚。

### E-02 AI 配置相关 rail 默认钉住治理

- 优先级:P0;依赖:E-01。
- 文件:`src/plugins/memory-coordinator/index.tsx`、`skill-hub/index.tsx`、`mcp-hub/index.tsx`、`marks/index.tsx`、`src/kernel/filePanel.ts` 测试。
- 实施:新装默认只钉 `memory-files` 作为“AI 配置”;`memory`、`skill-hub`、`mcp-hub` 默认不钉;marks 可默认不钉并移除新的自动补钉,保留上下文入口。
- 数据兼容:老用户 persisted 清单不变;不清 `tmd.filePanel.autopin.*` 历史标记。
- 测试/验收:新装默认入口减少;溢出菜单可恢复;Skills/MCP 中央 tab 不因取钉而关闭;marks 编辑器/Composer/终端回链不受钉住影响。
- 回滚:恢复 pinned 声明,无数据回滚。

### E-03 CLI 配置与资产纳入同一导航语义

- 优先级:P1;依赖:E-01。
- 文件:`src/plugins/cli-config/index.tsx`、`src/plugins/assets/index.tsx`、`src/plugins/memory-coordinator/panel/AiConfigHome.tsx`、设置深链测试。
- 实施:可见标题/描述统一为“AI 配置”的子能力;保留 `cli-config`、`assets` section id 与 `engines/agents/prompts` tab id;提供返回 AI 配置落地的导航。
- 数据兼容:CLI 写适配器、`.bak-tmd`、未知字段保留、assets 目录与引用三元组不变。
- 测试/验收:各引擎配置读写、原始编辑、供应商渠道、agents/prompts CRUD/导入不回归;旧 `openSettingsPanel` 深链不变。
- 回滚:恢复标题与导航卡,无存储变化。

### E-04 会话预设与提示词资产只做双向深链

- 优先级:P1;依赖:E-01。
- 文件:`src/plugins/workspace/SessionPresetsDialog.tsx`、`PresetFormCard.tsx`、`sessionPresets.ts`、`src/plugins/memory-coordinator/panel/AiConfigHome.tsx`。
- 实施:预设编辑中可打开提示词库;AI 配置页只提供“在工作区中管理会话预设”的说明/导航。预设仍从工作区菜单打开,不在全局资产页复制 CRUD。
- 数据兼容:`session-presets.json` 不变;`prompt.ref` 继续按 `(scope,wsId,name)` 全等现读;不迁移内联 prompt,不猜失效引用。
- 测试/验收:全局/工作区提示词引用、改名/删除后的灰态、model/worktree 启动、名称冲突与写失败回滚不回归。
- 回滚:删除新增链接,无数据回滚。

### E-05 Memory 高级运维降层,不动后台装配

- 优先级:P1;依赖:无,产品可先确认高级项范围。
- 文件:`src/plugins/memory-coordinator/panel/MemoryPanel.tsx`、`console/MemoryConsole.tsx`、`index.tsx`、wiki/phase2 相关视图。
- 实施:常用层保留状态、记忆文件和规则体检;预蒸馏检查器、访问排行、故障注入、worker 日志等收“高级”。`attachAutoDistill` 与 `attachWikiStore` 仍在 activate 唯一装配。
- 数据兼容:外部 SQLite、wiki、自动蒸馏开关和日志不变。
- 测试/验收:高级项全部可达;胶囊跳转准确;禁用/启用设置语义不变;无重复 worker/wiki 订阅。
- 回滚:恢复原 tab 展示,无数据回滚。

## 7. 批次 F:远程与设置归组

### F-01 新建工作区/会话统一本地、SSH、WSL 来源

- 优先级:P1;依赖:B-04。
- 文件:`src/plugins/workspace/SessionMenu.tsx`、`WorkspaceAddDialog.tsx`、`src/plugins/ssh/MenuEntry.tsx`、`src/plugins/wsl/contributions.ts`、`src/kernel/workspaceOrigins.ts`。
- 实施:统一分组和来源说明,复用 `workspace.newSessionMenu` 与 `workspaceOrigins`;本地/SSH/WSL 的启动、认证和路径校验仍由原插件负责。
- 数据兼容:工作区 root、wsl 元数据、主机 id、凭据不变。
- 测试/验收:本地新建、SSH 主机选择、WSL 本机 UNC/远程 `~`、引擎探测、无效路径与插件禁用回退不回归。
- 回滚:恢复原菜单布局,不改变已创建工作区。

### F-02 右栏“远程”落地页承接 SSH/WSL

- 优先级:P1;依赖:B-04、F-01。
- 文件:`src/plugins/ssh/index.tsx`、`panel/SshPanel.tsx`、`panel/RemoteHomePanel.tsx`(新增)、`src/plugins/wsl/index.tsx`、`WslCard.tsx`。
- 实施:SSH 面板 label 改“远程”;按当前会话/工作区显示 SSH 连接/SFTP/转发或 WSL 状态与打开按钮。WSL 中央 tab 保留;右 rail WSL 动作可撤或默认不钉。SSH 禁用时 WSL 仍有新建来源和可达 tab。
- 数据兼容:不改 russh、known_hosts、SFTP、端口转发、spec/shell provider、只读文件或 UNC 迁移。
- 测试/验收:SSH 会话状态/重连/远程编辑、WSL 工作区/终端/文件均不回归;远程面板不会把纯本地会话误认成 SSH/WSL。
- 回滚:恢复 SSH label 与 WSL rail 动作,后端未改。

### F-03 设置采用 7 个导航组,保留原 section/tab id

- 优先级:P1;依赖:A-02 可先完成,其他 section 可逐步接入。
- 文件:
  - `src/kernel/settingsRegistry.ts`:增加可选 `navGroup` 元数据,不改变 section 唯一性与删除语义。
  - `src/plugins/settings/SettingsPanel.tsx`:渲染“组 → 原 section → 原 tab”;深链目标自动展开所属组。
  - 各 section 所属插件 `index.tsx`:设置 navGroup。
  - 设置样式与 `src/plugins/settings/` 相关测试。
- 目标分组:
  - 通用:basic、wallpaper;
  - 会话与工作区:workspace-groups;
  - AI 配置:cli-config、assets;
  - 远程与访问:web-access、ssh;
  - 通知:notify;
  - 工作台与回顾:workbench;
  - 系统与数据:storage、extensions;intent-canvas 若保留则暂归系统高级。
- 实施:这是**导航分组**,不是把多个插件注册合并成同一 section id;避免 `registerSettingsSection` 重号、回滚误删和深链迁移。
- 数据兼容:`basic/cli-config/...` 与所有 tab id 原样保留,不需要 id 别名;settings.json 不变。
- 测试/验收:一级导航组=7;每个原 section/tab 可达;远程徽标、Composer 抽屉和旧 openSettingsPanel 深链均落原 tab;插件禁用只移自己的 section。
- 回滚:SettingsPanel 恢复平铺 section 导航,navGroup 元数据可保留无副作用。

### F-04 系统设置与“恢复精简布局”收口

- 优先级:P1;依赖:F-03、D-02、E-02。
- 文件:`src/plugins/storage-audit/index.tsx`、`local-loader/ExtensionsSettingsTab.tsx`、`network-proxy/index.tsx`、`session-budget/index.tsx`、`src/kernel/filePanel.ts` 与钉住 UI。
- 实施:
  - storage、extensions 归“系统与数据”;网络代理保留右 rail 高级动作,可在远程设置提供说明链接。
  - session-budget 显示名统一“列表配额”,本批可保留 caption,禁用编辑器不改变预算值。
  - 增加用户主动确认的“恢复精简布局”:只重置 rail 钉住清单到当前产品默认,不清其他 localStorage;提供取消和结果说明。
- 数据兼容:预算值、代理值、存储清理白名单不变;只有用户确认后才写钉住 key。
- 测试/验收:预算禁用后仍生效的语义有测试;恢复布局不影响工作区/主题/搜索折叠;无隐式清理。
- 回滚:恢复名称与入口;若用户已确认重置钉住,回滚代码不擅自再次改写其清单。

## 8. 批次 G:RPC 会话命名与新建入口

### G-01 统一命名与新建入口,保留两种会话类型

- 优先级:P1;依赖:无。
- 文件:
  - `src/plugins/structured-session/index.tsx`:移除右 rail 动作,改贡献 `workspace.newSessionMenu`。
  - `src/plugins/structured-session/NewSessionEntry.tsx`(新增):列出声明 `structuredRpc` 的 omp/pi,打开独立 RPC tab。
  - `src/plugins/structured-session/tabs.ts`、`sessionTab.tsx`:标题/空态明确“RPC 交互会话,独立会话”。
  - `src/plugins/session-viewer/index.tsx`、`livePill.tsx`、`viewerTab.tsx`:统一“幕布 / 转录”文案。
  - 三语词典与相关测试。
- 实施:不把 RPC 入口伪装成当前 PTY 会话的模式按钮;不为 PTY 增加 RPC 切换;不共享 cliSessionId。
- 数据兼容:RPC 草稿、断线恢复、会话身份与共同存证 key 不变。
- 测试/验收:新建菜单只在有能力引擎时显示;omp/pi 可新建;无 RPC 引擎无死入口;PTY 转录仍只读;RPC 仍可交互。
- 回滚:恢复右 rail 动作和旧文案,后端不动。

### G-02 会话身份、存证与转录深链回归

- 优先级:P1;依赖:G-01。
- 文件:`src/plugins/structured-session/tabs.ts`、`evidence.ts`、`src/plugins/session-viewer/`、`src/plugins/checkpoints/`、`src/plugins/footprint/` 或迁移后的 workbench 对应模块。
- 实施:补测试固定 structured tab 与 PTY tab 的身份解析、checkpoint/footprint 副键、转录打开/导出和会话退出清理。
- 数据兼容:不改证据格式;旧 RPC tab/账本/足迹记录可回跳。
- 测试/验收:RPC ↔ checkpoint/footprint、PTY ↔ viewer/checkpoint 两条链均通;不存在“同 id 跨后端打开错误会话”。
- 回滚:随 G-01 回滚 UI;无数据迁移。

## 9. 批次 H:可选化与依赖清理

### H-01 anim 可选化

- 优先级:P2;依赖:**先确认承接形态**。
- 文件:`src/plugins/anim/`、`src/plugins/index.ts`、快捷键/图标装饰/词典、相关测试与文档。
- 实施:可选插件包先具备同等能力,再移除内置注册;同时清 `anim.new-session`/`Cmd+N`、tab、rail、AnimRefChips、send transform、undo、empty-send provider。
- 数据兼容:`~/.tmd-anim/projects` 原样保留;提供外部打开/项目目录说明;不清快捷键 overrides 中其他命令。
- 测试/验收:主客户端无残留 anim 入口/命令;其他 Composer chips 的 transform/undo/empty-send 不受影响;可选包能打开原项目。
- 回滚:恢复内置插件注册与目录即可读原项目;无数据迁移。

### H-02 ports 可选化

- 优先级:P2;依赖:**先确认官方可选工具还是高级内置**。
- 文件:`src/plugins/ports/`、`src/plugins/index.ts`、右 rail/中央 tab/词典/测试。
- 实施:按决策完整移出或仅默认不钉并归高级;停止面板后无 5s 轮询;kill 路径只存在于明确启用的能力中。
- 数据兼容:无持久用户数据;保留工作区会话跳转语义至可选包。
- 测试/验收:主链无 ports 残留;若可选启用,过滤、归因、浏览器打开、SIGTERM→SIGKILL 与取消轮询按原契约。
- 回滚:恢复插件注册,无数据回滚。

### H-03 intent-canvas 可选化

- 优先级:P2;依赖:**先确认可选包与存量文件打开方式**。
- 文件:
  - `src/plugins/intent-canvas/`、`src/plugins/index.ts`;
  - `src/plugins/files/FileTreeContextMenu.tsx`、`useTreeOperations.ts`;
  - Composer 扩展注册、设置、词典、图标装饰;
  - `package.json`、lockfile、Excalidraw 裁剪脚本(可留 H-05 统一处理)。
- 实施:完整移除 rail/tab/`Cmd+Alt+I`/设置/chips/作画开关/send transform/undo/session 清理/inbox poller/OS 通知;文件树 `.excalidraw` 不再向已不存在的 kind 发深链或预热依赖。
- 数据兼容:`~/.tmd-cli/intent-canvas/`、用户 `.excalidraw`、inbox/failed 不删;迁移说明提供目录打开与导出路径。
- 测试/验收:无后台轮询/通知/发送注入残留;files 不再引用 Excalidraw;可选包能打开旧 sidecar;其他 Composer 扩展正常。
- 回滚:恢复内置插件和 files 深链即可读原数据;依赖恢复随代码回滚。

### H-04 壁纸与图标装饰收缩决策后实施

- 优先级:P2;依赖:**产品明确收缩范围**。
- 文件:`src/plugins/wallpaper/`、`src/plugins/settings/IconDecorCard.tsx`、`iconDecorItems.tsx`、`src/kernel/iconSet*`、主题/表面 token、构建依赖。
- 实施分支:
  - 保守:静态图库保留并归通用/外观,流体默认关,不新增装饰;
  - 收缩:移除流体与部分装饰,但保留静态图库、主题、字号/缩放/终端字体;
  - 激进:壁纸整体可选化,需验证所有表面 token 恢复与 overlay 层梯。
- 数据兼容:不删受管图片;旧 wallpaper/icon 设置做 sanitize 回落,不影响其他外观设置。
- 测试/验收:幕布、设置、市场、菜单、弹层、文件预览透明度和对比度逐项目检;reduced motion 与性能不回归。
- 回滚:恢复效果代码与设置映射,原图库仍在。

### H-05 依赖与包体最后清理

- 优先级:P2;依赖:H-01/H-02/H-03 及 H-04 中确定的删除全部完成。
- 文件:`package.json`、`pnpm-lock.yaml`、`vite.config.ts`、构建脚本、动态 import、类型声明与相关文档。
- 实施:全仓确认无引用后再删 Excalidraw 等依赖;只清已无人消费的裁剪步骤/chunk 逻辑;记录首包、主 chunk、安装包前后对比。
- 数据兼容:无。
- 测试/验收:完整门禁、production build、首屏与保留功能按需加载正常;无因共享依赖误删导致 Markdown/文件预览/图标回退。
- 回滚:恢复依赖声明、lockfile 和构建脚本。

## 10. 批次 I:使用证据评估,不预设删除

### I-01 LSP 与 Office 内嵌预览评估

- 优先级:P2;依赖:无;未收口前不得列确定删除。
- 文件:`src/plugins/lsp/`、`src/plugins/files/`、`package.json`、相关错误/性能日志。
- 实施:收集一个版本周期的使用证据或代表性用户任务:功能启用率、成功跳转/预览率、失败类型、维护问题、跳出应用成本;无遥测时用人工诊断与访谈,不伪造频率。
- 决策闸:保留核心 / 默认不启用 / 可选插件 / 删除四选一;按真实证据记录理由。
- 验收:任何选择都保留系统打开和纯文本降级;配置与文件内容不因评估被收集或删除。
- 回滚:评估本身无行为变化。

### I-02 docgen、自建中继、平铺广播与重型装饰评估

- 优先级:P2;依赖:无。
- 文件:`src/plugins/workbench/docgen/`、`src/plugins/web-access/`、Composer/平铺广播相关模块、`wallpaper/` 与设置装饰模块。
- 实施:分别记录独有价值、维护接触面、风险与目标用户场景;不能用“代码多”单项裁决。docgen 可暂停扩张,自建中继可降高级,广播必须保留防误发。
- 决策闸:每项独立拍板,不打包成“复杂功能全删”。
- 验收:若保留,明确下一版不再扩张的边界;若移出,按 H 组同标准处理数据、入口、后台和依赖。
- 回滚:评估本身无行为变化。

## 11. 最终收口清单

### 11.1 信息架构

- [ ] 左 rail 为工作台、首页、工作区切换、设置 4 项。
- [ ] 学堂不再常驻左栏;搜索仍只有一个左栏入口。
- [ ] 新装默认右 rail 为 5 面板 + 2 动作;其余能力有明确可达路径。
- [ ] 设置为 7 个导航组;旧 section/tab 深链继续工作。
- [ ] 工作台主 tab 仍为 5 个;回顾含工作日志/每日足迹/会话活动。
- [ ] 搜索只有一套当前可用浮层壳,三命令与 `Cmd+L` 历史语义不混。
- [ ] RPC 会话从新建菜单可达,未与 PTY 做隐式模式互切。
- [ ] 无“建设中”死展示、死按钮、死快捷键或死设置。

### 11.2 生命周期与数据

- [ ] boardExit、footprint rollup、checkpoints、approval boot 均只有一个责任宿主。
- [ ] workbench journal/docgen、Memory autoDistill/wiki 无重复装配。
- [ ] 移除的能力没有残留轮询、OS 通知或 Composer 注入。
- [ ] 工作区、会话、账本、日报、足迹、通知、Ask 历史、资产、预设和远程信任数据均可读。
- [ ] 老用户钉住清单未被强制覆盖;恢复精简布局必须显式确认。

### 11.3 核心回归

- [ ] 新建/恢复/重启恢复/归档/删除/续聊。
- [ ] PTY 透传/Composer/Ask/通知/额度。
- [ ] checkpoint 归批/审阅/回退/应用/反悔/转录互跳。
- [ ] Git diff/commit/branch/stash/worktree。
- [ ] 日报/便签/docgen/足迹修正/会话活动深链。
- [ ] RPC 发送/审批/断线/共同存证;PTY 只读转录。
- [ ] CLI 配置/Skills/MCP/Memory/assets/presets 读写。
- [ ] SSH/SFTP/转发/远程编辑与 WSL 工作区/终端/文件。
- [ ] 手机配对/重连/发送/图片/审批/历史/Git。
- [ ] 本地插件信任/启停/回退。

### 11.4 工程证据

- [ ] 每批完整门禁、react-doctor 100、真实窗口目检记录齐全。
- [ ] Rust 触及批次三命令齐全。
- [ ] 词典、快捷键、图标装饰、tab kind、localStorage、import 残留扫描完成。
- [ ] 首包、主 chunk、安装包和关键懒加载路径有前后数据。
- [ ] 五条主任务路径有前后对比:新建会话、处理 Ask、审阅变更、找到某日工作、修改 AI 配置。
- [ ] `docs/FEATURES.md`、架构契约和文档索引随真实落地同步更新;未落地项不得写成已完成。

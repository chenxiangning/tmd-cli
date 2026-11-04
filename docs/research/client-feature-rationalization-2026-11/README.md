# 下一版客户端功能减法与合并重构调研(代码校准重构版)

- 日期:2026-11-03
- 基线:当前工作树,`package.json` 版本 0.4.8
- 范围:桌面客户端、移动 Web UI、远程访问、内置插件与主要维护依赖
- 状态:全量重构版;删除/移出候选仍需产品决策,本报告不实施功能变更
- 配套清单:[最新实施清单](implementation.md)
- 非目标:不介入发版,不调整版本号,不给出未经使用数据支持的“没人用”结论

## 0. 结论先行

下一版应收敛为:**多 CLI 会话工作台 + 等待处理/变更审阅/Git 交付 + 轻量远程续作**。减法的主要对象不是十家引擎和会话主链,而是重复的信息架构、偏离主线的默认内置工具,以及高维护但价值尚未验证的扩展面。

推荐决策包如下:

1. **可直接删除的确定项很少**:插件市场“在线市场建设中”占位可以删;其他能力不能只凭代码体量或主观低频直接删除。
2. **建议移出默认内置三项**:`anim`、`ports`、`intent-canvas`。它们可转为独立工具或可选本地插件,但必须连同快捷键、Composer 扩展、文件菜单、设置、后台轮询和依赖一起处理,不能只撤图标。
3. **合并六组信息架构**:回顾、待处理与变更、搜索、AI 配置导航、远程工作区入口、设置分区。合并界面不等于合并数据模型。
4. **保留两种会话后端**:PTY 会话内可有“幕布/只读转录”两种视图;omp/pi RPC 交互会话仍是独立会话、独立 tab、独立身份。只做命名和新建入口统一,不做同会话三模式切换。
5. **工作台不是纯回顾工具**:项目、聚焦、任务、文档均有独立价值。只把现有“工作日志”扩为“回顾”,承接日报、足迹和会话活动;主 tab 数保持 5 个,不再强行合并“概览 + 聚焦”。
6. **通知中心不进审批**:Ask 等待与 checkpoint 变更可合成“处理”面板;通知中心是 Ask、轮次结束、退出、额度等历史流水,保留独立面板,默认不钉即可。
7. **AI 配置统一导航,不统一存储**:CLI 配置、Skills、MCP、Magic Context、原生记忆文件、智能体/提示词共用一个入口;会话预设留在工作区上下文,通过已有提示词引用和深链协作。
8. **精细化的验收不是删行数**:应同时验收默认入口数、主任务路径、存量数据可达性、后台生命周期不回归、包体与首屏变化。

### 0.1 本版对上一版的纠错

| 上一版表述 | 代码校准后的结论 |
| --- | --- |
| 右栏“17 个入口”像同时外显的固定事实 | 17 是全插件启用时的注册能力总数。实际外显 = 已钉住 ∪ 激活;新装无持久清单时当前声明均默认钉住,老用户以本地钉住清单为准 |
| session-viewer + structured-session 合成同一会话三模式 | 撤回。前者已经覆盖磁盘只读 tab 与 PTY 活会话转录浮层;后者是 omp/pi RPC 独立交互会话,不能隐式互换身份 |
| 工作台压成概览/任务/文档/回顾四域,并合并概览 + 聚焦 | 撤回。保留 overview/focus/board/docs 四个独立主域,仅把 journal 扩成“回顾”,主 tab 仍为 5 个 |
| approval-inbox + checkpoints + notify-center 全并审批 | 撤回通知合并。Ask 与文件变更可同面板;通知历史不是待办,应独立保留并降默认钉住层级 |
| AI 配置资产包含会话预设 | 修正。预设属于工作区启动上下文,存 `session-presets.json`;只与提示词资产引用/深链,不迁移存储 |
| 搜索是三个并列入口 | 修正。左栏只有一个 SearchHubEntry;search 内部已共用一个壳承载全文/快开,session-search 另有第二套壳 |
| anim 只是动画项目启动器,删 rail/tab 即可 | 修正。还包括 `Cmd+N`、Composer chips、发送变换、失败 undo、空输入放行 |
| session-board/footprint 只是重复 UI | 修正。前者挂干净退出自动归档,后者挂 checkpoint 封口 rollup 与功能卡写事件刷新 |
| 拔出 session-budget 会回默认分页 | 修正。它只是设置编辑器;已写预算由 kernel/settings 持有,禁用编辑器不会改变既有预算 |
| 插件市场入口可连同 `market.local` 一起删 | 修正。本地插件管理由 local-loader 经该挂点贡献;入口迁移必须保留或替换有效宿主 |

这些纠错直接影响实施顺序,不是文案细节。

## 1. 方法、口径与证据边界

### 1.1 事实源与盘点方法

- 以 `src/plugins/index.ts` 的 `allPlugins` 为插件全集,当前为 **48 = 10 engine + 34 feature + 3 core + 1 local**。
- 以各插件 `activate(ctx)` 为主证据,核对文件面板、rail 动作、中央 tab、overlay、设置 section、命令、Composer 扩展、远程来源和事件订阅。
- 以 `src/app-shell/LeftRail.tsx`、`PanelRail.tsx`、`src/kernel/filePanel.ts` 校准“注册”与“实际外显”的区别。
- 以 `docs/FEATURES.md` 补充用户能力面;文档与当前代码冲突时以代码为准。例如 `session-budget` 的禁用语义以插件当前头注和实现为准。
- 对 `.ts/.tsx/.rs/.css` 重新统计当前工作树,排除 `.test.` 与 `locales`;行数只表示维护接触面,不表示用户价值,也不等于可净删行数。
- 本报告与实施清单使用同一组任务 ID,便于逐项追踪。

### 1.2 本报告不能证明什么

- 没有点击遥测、功能使用频率、留存、崩溃归因或用户分群数据。
- 本轮未启动真实客户端,避免与另一项发版工作相互干扰;因此不声称已完成真机交互验收。
- 原生 iOS/Android 壳未逐文件重审;移动 Web 的 home/session/history/git 主路由和远程桥主链已核对。
- 十家引擎按核心基础设施盘点,没有把引擎私有格式的每个字段展开为删减候选。
- “推荐移出”“建议降层”是产品判断,不是“低频已证实”。“待验证”项目必须补使用证据或明确产品决策后才能删。

### 1.3 六档处置定义

| 档位 | 含义 | 数据原则 |
| --- | --- | --- |
| 直接删除 | 已确认是无真实能力的占位/死展示 | 无用户数据,可随代码删除 |
| 移出默认内置 | 能力可存在,但不随主客户端默认提供 | 原数据保留,提供打开/导出或可选插件路径 |
| 合并重构 | 统一导航、视图或宿主,必要时合并插件装配 | 明确哪些后端与存储绝不合写 |
| 降层 | 保留能力,撤一级入口、默认钉住或设置一级 section | 无数据迁移,保留深链/命令可达 |
| 保留打磨 | 主链或独有价值明确,不做功能面扩张 | 优先可靠性与交互质量 |
| 待验证 | 价值/成本无法仅靠静态代码裁决 | 补使用证据或产品拍板后再定 |

## 2. 当前功能全量地图

## 2.1 十个 engine 插件

| 插件 | 当前集成与独有能力 | 处置 |
| --- | --- | --- |
| cli-omp | CLI profile、安装/版本、历史预热接管、命令/技能、编辑事件、结构化 RPC、Memory 写入协作、课程与二级市场等 | 核心保留;不为减入口破坏适配器与 RPC 能力声明 |
| cli-pi | CLI profile、磁盘会话、命令/技能、结构化 RPC、流式转录与课程 | 核心保留;RPC 与 PTY 身份继续分离 |
| cli-kimi | CLI profile、会话 JSONL 适配、命令/技能发现、状态/转录与课程 | 核心保留 |
| cli-codex | rollout 会话适配、apply_patch/edit 解析、状态与官方 OAuth 本地额度快照 | 核心保留;编辑归因不可被 UI 合并误伤 |
| cli-claude | 会话 JSONL、summary/标题、状态、命令/技能与本地用量窗口推算 | 核心保留;本地推算是无公开额度 API 下的独立价值 |
| cli-grok | 会话适配、`inspect --json` 命令发现、状态/转录与课程 | 核心保留 |
| cli-qoder | Qoder 会话与命令适配,复用 qoder 家族共享实现 | 核心保留 |
| cli-qoder-cn | 中国站变体,复用同族 glyph/静态表和适配逻辑 | 核心保留;可与 cli-qoder 继续共享代码,但不删产品身份 |
| cli-dsh | DeepSeek Harness host 配置、home 引导、适配器部署、host RPC 会话、zstd 转录、上下文压力与课程 | 核心保留;不是普通 JSONL 引擎,不能套用统一磁盘假设 |
| cli-opencode | SQLite/会话适配、状态、无头生成支持、安装脚本与课程 | 核心保留 |

**减法结论**:十家引擎不是本轮删减对象。可做且已经部分存在的是“同族共享代码、按可用状态呈现”,不是删引擎数量来换取表面简洁。

## 2.2 三个 core、一个 local 与系统底座

| 模块 | 功能与入口 | 隐藏职责/依赖 | 处置 |
| --- | --- | --- | --- |
| composer(core) | 富输入、触发符、附件、命令抽屉、输入历史、发送/广播、状态栏、额度 chip | `composerExt` 被 assets、marks、anim、workbench、intent-canvas 等共同扩展 | 核心保留;只减不必要贡献者,不改核心发送契约 |
| settings(core) | 设置 overlay;basic section 内已有外观/行为/打开方式/快捷键 4 tab | `settingsRegistry` 深链按 section/tab 定位 | 核心保留;重分组必须兼容深链 |
| welcome(core) | 引擎选择、新建/续作、安装更新、凭据/额度、dsh home panel | 与 engine profile、探针、安装器和 quota 注册表联动 | 核心保留;可承接帮助入口,不扩成第二工作台 |
| local-loader(local) | 本地插件扫描、信任确认、版本回退、开发提示词、禁用/重扫 | UI 经 `market.local` 贡献;实际装载与信任在 kernel/localPlugins | 保留;市场入口迁移时不能留下空挂点 |
| kernel/app-shell/Rust | 会话生命周期、PTY、回放、tabs、命令、注册表、文件/Git/SSH/Web 桥、窗口与远程传输 | 是所有功能共享底座 | 保留打磨;不把单插件业务语义迁入 kernel |

## 2.3 三十四个 feature 插件逐项盘点

下表同时列出“看得见的入口”和“撤入口不会自动消失的职责”。“任务”指向配套实施清单,不代表已执行。

| 插件 | 当前功能与主要入口 | 非 UI 职责、数据或依赖 | 建议与任务 |
| --- | --- | --- | --- |
| session-budget | 工作区 caption 弹窗;会话列表总数与各 CLI 露出配额 | 只编辑 kernel/settings;禁用插件后既有预算仍生效 | **保留降层**,改名“列表配额”,入口可迁会话设置;F-04 |
| workspace | 工作区 CRUD/分组/显隐、十引擎新建与恢复、归档/删除/置顶、会话预设、worktree 归簇、批量导出 | 会话身份、磁盘回放、卫生清扫、恢复、预设存储与大量深链 | **核心保留**;统一远程新建入口,承接 boardExit;B-01/F-01/G-01 |
| files | 文件树 CRUD、编辑/保存、Markdown/KaTeX/Mermaid、图片/PDF/docx/xlsx、打开方式、文件 tab | 草稿/关闭闸、文件视觉、编辑器扩展、远程文件源消费;含 `.excalidraw` 导入深链 | **核心保留**;重型预览待验证,画布移出时清文件菜单;H-03/I-01 |
| git | 多仓、status/diff、提交/amend、分支/合并/变基、stash、fetch/pull/push、Graph、commit diff、worktree | Rust git2、缓存、终端凭据引导、中央 diff tab、文件 Blame 联动 | **核心保留并打磨**;不与 checkpoints 合后端 |
| checkpoints | 右栏审批线/时间线/变更总览,中央批审阅,回退/应用/反悔 | prompt/edit/turn/exit 订阅、4s 磁盘事件拉取、账本/快照/状态机 | **核心保留**;与 Ask 合宿主时必须保留整套装配;B-03/D-01 |
| network-proxy | 右 rail 底部代理浮层,客户端及后续子进程代理 | settings + Rust env 注入/恢复;禁用涉及真实联网行为 | **保留高级动作**,不与远程工作区混概念;F-04 |
| ssh | 新建 SSH 会话、主机簿/known_hosts、SFTP、远程编辑、端口转发、右栏面板 | 模块加载重接线、SFTP 事件、会话镜像、远程保存与脏稿闸、Rust russh | **保留后端**;面板改“远程”导航,设置与 WSL 归组;B-04/F-01/F-02 |
| terminal | 右 rail 新建本机 shell,继承当前工作区目录 | 一等 PTY 会话;WSL shell spec provider 可改写 | **保留独立动作**,不与 SSH/WSL 同义化 |
| memory-coordinator | Memory 与“AI配置管理”两个右栏面板;Memory 控制台、agent wiki、lint report 三个中央 tab;Composer 胶囊 | activate 启动 autoDistill/wiki;外部 Magic Context SQLite;原生记忆文件与规则写回是另一后端 | **统一 AI 配置导航**,高级运维降层;不合存储;E-01/E-02/E-05 |
| assets | 设置中的智能体/提示词双 tab,三源导入;Composer `!!`/`##`、唤醒图标与角色发送变换 | 全局/工作区资产库、选中智能体按会话持久化、提示词引用被 presets 消费 | **管理入口并 AI 配置**,Composer 消费保留;E-01/E-03/E-04 |
| cli-config | 设置中的各 CLI 配置、供应商渠道、原始配置编辑 | 各引擎声明 schema + load/save;写回需备份与未知字段保留 | **管理入口并 AI 配置**,不重写方言存储;E-03 |
| wsl | WSL 中央 tab、右 rail 动作、本机/远程 WSL 工作区、引擎探测、只读文件通道 | remote file source、workspace origin、spec wrapper、shell spec、存量 UNC 元数据迁移 | **保留后端**,入口并远程工作区;不可只删插件;B-04/F-01/F-02 |
| wallpaper | 图库、轮播、流体 WebGL、模糊/加暗/表面透底,设置一级 section | 全局背景层、主题 token 打穿、`wallpaper.json` 与受管图片目录 | **静态壁纸可降层;流体/复杂装饰待决策**;H-04 |
| session-board | 左 rail 全屏看板:热力月历、日泳道、未读/归档导航、重命名 | `sessionExited` 订阅;干净退出且已读自动归档 | **界面并回顾**,先迁生命周期再撤插件;B-01/C-03/C-04 |
| intent-canvas | 画布管理/编辑、结构化关联、AI 作画、文件导入;右 rail、`Cmd+Alt+I`、设置、Composer chips/开关 | 2s inbox 轮询、OS 通知、send transform/undo、sidecar、Excalidraw、文件树入口 | **建议移出默认内置**,完整拆贡献与依赖;H-03 |
| marks | 文件锚点、跨文件聚合、右栏标记面板、Composer chips、终端回链 | 编辑器扩展、终端 link provider、send transform/undo/pending count、checkpoint 证据 | **保留**;默认钉住可降层,但不与搜索合并;D/E 入口治理 |
| web-access | 设置中的 LAN/Cloudflare/自建中继/设备/安全;顶栏远程控制徽标 | Rust Web 桥、配对/安全/风险门、部署历史、移动连接 | **保留远程主链**;设置并“远程与访问”,自建部署待验证;F-03/I-02 |
| search | 左栏 SearchHubEntry;全文 `Cmd+Shift+F`、快开 `Cmd+P`;两视图已共用一个 overlay | Rust 文件扫描/索引,fuzzy;与 session-search 是第二套壳 | **统一浮层壳和作用域**,保留三命令;D-03/D-04 |
| lsp | TS/JS/Python/Java 定义、引用、hover、peek、服务器安装引导 | Rust LSP 通用原语、语言服务器生命周期、编辑器扩展 | **待验证**;可转可选 IDE 能力,不直接判删;I-01 |
| prompt-enhancer | Composer 草稿 AI 改写与对照 | 一次性 CLI `proc_communicate`、多引擎 argv | **保留为会话动作**,不新增管理面 |
| approval-inbox | 右栏“审批”:聚合 Ask 等待、直达、自由文本/键序作答、Ask 历史 | boot 订阅 ask/host,1.5s 重同步;`tmd.askHistory.v1` 50 条 | **与 checkpoints 合“处理”面板**,保留 store/boot;B-03/D-01 |
| academy | 左栏课程进度入口、入门 overlay、指南中央 tab;课程内容来自引擎插件 | 引擎课程注册、进度、版本漂移与前置闸 | **撤侧栏常驻入口**,课程可留帮助/欢迎页;A-03 |
| notify | OS 通知、声音、免打扰、会话静音、额度预警;通知中心历史面板 | ask/turn/exit 事件、blur/focus、quota poll、`notify-log.json`、深链身份快照 | **保留独立历史与发送链**,默认不钉;不并审批;D-02 |
| session-search | `Cmd+O` 会话全文/标题、当前/全部工作区、引擎/时间过滤、行级定位 | 增量索引、跨区切换、失效区处理、第二套 overlay/focus/toast | **与 search 共壳**,保留索引与定位语义;D-03/D-04 |
| session-relay | 跨引擎摘要接力、预览编辑、新会话首发 | Composer 首发/重试、会话上下文与发送契约 | **保留为会话动作**,不设一级管理面 |
| skill-hub | 右栏 Skills + 中央管理 tab;安装、更新、本地/GitHub 导入、商店 | 安装记录与磁盘扫描是不同口径,曾有明确不合并裁决 | **管理入口并 AI 配置**,能力保留;E-01/E-02 |
| mcp-hub | 右栏 MCP + 中央管理 tab;配置写回、商店、导入、删除、连通测试 | 多源配置方言、草稿/写回与错误分源 | **管理入口并 AI 配置**,不合 Skills 数据;E-01/E-02 |
| session-viewer | 磁盘只读 tab、PTY 活会话转录浮层、幕布切换 pill、导出与定位 | 各引擎 `readSessionTranscript`;sessionExited 清理视图态 | **保留并统一命名**;只作 PTY 会话只读视图;G-01/G-02 |
| structured-session | omp/pi RPC 独立交互 tab、流式块、审批、模型/思考、草稿/断线接续 | `proc_stream`/piRpc、独立会话身份、keepAlive、checkpoint/footprint 存证 | **保留后端和独立 tab**;右 rail 新建入口迁工作区并改名;G-01/G-02 |
| workbench | 左 rail 工作台;概览/聚焦/任务/文档/工作日志 5 tab;项目详情、docgen、任务关联会话 | journal/docgen 调度与生成、任务卡 Composer 扩展、index watch、workbench/daily 数据 | **保留项目主链**;journal 扩“回顾”承接两视图;C-01/C-02/C-03 |
| anim | 动画项目列表、应用打开、AI 启动会话;左 rail、`Cmd+N` | Composer chips、send transform/undo、empty-send、`~/.tmd-anim/projects` | **建议移出默认内置**;完整清贡献;H-01 |
| storage-audit | 设置中的十二类存储体检、checkpoints/docgen 白名单清理 | 只读 fs_dir_usage;CLI 会话目录只报告不代删 | **保留在系统设置**,不设独立产品入口;F-04 |
| footprint | 左 rail 每日足迹:月历、功能卡、证据 diff、日报互跳、修正层、反查 | activateRollup、checkpoint 封口刷新、features 写事件、月度/日 JSON 与 user layer | **界面并回顾**,先迁写侧装配再撤插件;B-02/C-02/C-04 |
| ports | 监听端口、进程家族、暴露面、工作区归因、浏览器/复制、二段 kill;右 rail 中央 tab | 平台进程命令、可选 5s 轮询、危险终止动作 | **建议移出默认内置或转可选工具**;H-02 |

## 2.4 用户能力域全量清单

插件清单仍不足以代表实际产品面。按用户任务看,当前客户端包含以下能力:

### A. 工作区与会话生命周期

- 本地、SSH、WSL 工作区;工作区分组、显隐、折叠、默认工作区兜底。
- 十引擎新建、磁盘历史、恢复、先行回放、身份绑定、去重、重启现场恢复。
- 会话重命名、全局/工作区置顶、归档、批量归档/删除、tombstone、卫生清扫。
- 会话列表预算、运行区、未读/等待状态、会话预设、worktree 预设与归簇。
- 转录导出、批量导出、接力、搜索、只读查看与 RPC 独立交互会话。

### B. 终端幕布与 PTY

- 原样字节流、xterm 幕布、后台常驻订阅、旋转日志、分块回放与翻页。
- 终端全文搜索、链接/文件路径点击、刷新、回底、冻结快照、渲染健康守望。
- tab 容量、平铺、广播、冻结/恢复、输出缓冲配置、终端字体与 ANSI 主题。
- 本机 shell、SSH 会话、WSL 包装共享幕布但语义不同。

### C. Composer 与会话动作

- 多行/IME、发送键配置、输入历史 `Cmd+L`、草稿安全网。
- `@` 文件、`/` 命令、`$` 技能、`!!` 提示词、`##` 智能体。
- 附件/图片/拖拽、任务卡/动画引用/marks/画布 chips。
- 命令抽屉、提示词增强、消息锚点、模型/思考/额度、Memory 胶囊。
- 发送变换、失败 undo、空输入 provider、平铺广播、跨引擎接力。

### D. Ask、通知与等待处理

- PTY 字节 + 屏幕态 Ask 检测、后台镜像、等待标签、作答抑制。
- 审批收件箱聚合、日志尾摘录、omp 卡键序、自由文本作答、Ask 历史。
- OS 通知、Ask/轮次结束音、免打扰、三档会话静音、异常退出 toast。
- 额度轮询和低水位预警、通知流水、跨重启身份快照回跳。

### E. AI 变更与审阅

- prompt 轮次锚点、事件/Git 双归因、文件快照、批次封口/修订。
- 时间线、批审阅、跨批次文件总览、危险路径提示、转录互跳。
- 整批/单文件回退、应用、反悔、dry-run、冲突与陈旧标记。
- checkpoints 对象库、审核状态、prune;结构化会话共同存证。

### F. Git 与交付

- 多仓发现/切换、status/diff、平铺/树形、单双栏、全文 diff。
- stage/unstage/discard、提交/amend、未跟踪/冲突/重命名处理。
- 分支、合并、变基、stash、fetch/pull/push、Graph 与 commit diff。
- worktree 创建/移除/归簇、文件历史与 Blame 深链。

### G. 文件、编辑器与代码智能

- 文件树、文本编辑、保存/脏稿/关闭闸、外部打开、文件视觉。
- Markdown/GFM/KaTeX/Mermaid/图片/大纲、PDF/docx/xlsx/csv。
- 文件全文搜索、文件名快开、终端路径跳转、marks、Git Blame。
- LSP 定义/引用/hover/peek 与服务器管理。

### H. 项目、文档与回顾

- 工作台概览、聚焦、任务看板、项目详情、任务执行记录、关联会话。
- 文档管理、docgen 模板/事实源/周期/版本链/生成队列。
- 工作日志年/月/轴、日报文章、便签、定时/补跑/增量生成。
- 每日足迹、功能卡修正、证据 diff、会话看板、日期/文章/会话深链。

### I. AI 配置与资产

- 引擎安装/更新/配置、供应商渠道、凭据与额度。
- Skills 安装/更新/导入/商店;MCP 配置/导入/商店/测试。
- 智能体/提示词、全局/工作区作用域、三源导入、会话预设引用。
- Magic Context、自动蒸馏、agent wiki、Memory 胶囊与控制台。
- 原生记忆文件、规则体检、备份/行守卫/应用记录。

### J. 远程、移动与系统

- SSH 主机/认证/known_hosts/SFTP/远程编辑/端口转发。
- WSL 本机/远程发行版、引擎探测、只读文件、shell 包装。
- LAN、Cloudflare、自建中继、设备配对、二维码、安全门、远程徽标。
- 手机 home/session/history/git、发送/图片/快捷键/审批/时间线/重连。
- 网络代理、存储体检、主题/语言/字号/缩放/Logo/图标/壁纸、本地插件。

## 3. 入口与信息架构的真实现状

## 3.1 左 rail、左栏补充入口与命令不是一回事

全插件启用时,左 rail 有 8 个入口:

1. workbench;
2. home;
3. market;
4. session-board;
5. anim;
6. footprint;
7. workspace-switch;
8. settings。

此外还有两类容易误算的入口:

- **左栏内容区**:academy 课程进度卡、SearchHubEntry;后者展开三项命令,不是一个 rail 图标。
- **工作区上下文**:session-budget caption、SSH 新建菜单、WSL 工作区来源、会话右键中的转录/接力/导出等。

因此目标“左 rail 8 → 4”只处理 rail,不会自动消除学堂、搜索、预算和新建菜单,必须分别给宿主。

## 3.2 右栏注册总数、默认钉住与实际外显

当前注册能力:

- **11 个 file panel**:files、git、checkpoints、approval-inbox、notify-center、memory、memory-files、skill-hub、mcp-hub、marks、ssh。
- **6 个 rail action**:wsl-panel、terminal、structured-session、ports、intent-canvas、system-proxy。

外显规则是:

```text
可见面板 = 已钉住面板 ∪ 当前激活面板
可见动作 = 已钉住动作 ∪ 当前激活动作
其余进入 ⋯ 溢出菜单
```

当前这些注册项没有声明 `pinnedByDefault: false`,所以:

- 新装且不存在持久钉住清单时,默认可钉住并外显全部 17 项;
- 老用户已有 `tmd.filePanel.pinned.v1` 时,以该清单为准,不能笼统说每个人都看到 17 个;
- 点击溢出菜单的未钉项会激活并顺带钉住,长期使用后入口可能继续增多。

这意味着“默认钉住治理”本身就是高收益减法,不必先删除功能。

## 3.3 设置一级 section 与深链

当前 11 个一级 section:

| section id | 当前内容 |
| --- | --- |
| basic | appearance、behavior、openwith、shortcuts 4 tab |
| cli-config | 引擎配置 |
| workspace-groups | 工作区分组 |
| wallpaper | 图库/背景 |
| web-access | lan、cf、selfhost、devices、security |
| assets | agents、prompts |
| notify | 通知 |
| workbench | 工作台偏好 |
| intent-canvas | 画布/AI 作画 |
| ssh | hosts |
| storage | 体检与清理 |

`SettingsPanel` 支持 `openSettingsPanel({section,tab})` 深链。重命名可见标题不影响 id,但改 section/tab id 会影响远程徽标、插件回退入口及其他深链,必须做映射或保留别名。

## 3.4 中央 tab 与 overlay 也已形成第二套导航

当前主要中央面包括:

- 会话相关:磁盘只读转录、RPC 交互会话、checkpoint 批审阅、Git diff/commit/file history。
- 管理相关:工作台、项目详情、日报文章、Skills、MCP、Memory 控制台、agent wiki、lint report。
- 工具相关:WSL、意图画布、动画项目、端口管理、学堂指南、本地/远程文件。

主要全屏/浮层包括:插件市场、会话看板、学堂向导、搜索两套壳、设置、SSH 主机/认证、代理、各类确认与编辑器。

**诊断**:问题不是“tab 数量”本身,而是同义能力分散在 rail、面板、中央 tab、overlay 和设置中,用户需要先理解载体再找到功能。下一轮应优先统一任务入口,而不是继续发明新载体。

## 4. 重复面与可合并边界矩阵

## 4.1 工作日志 + 每日足迹 + 会话看板

| 维度 | 工作日志 | 每日足迹 | 会话看板 |
| --- | --- | --- | --- |
| 核心对象 | 日文章、便签、生成任务、项目/任务关联 | 功能卡、rollup、文件/Git 证据、修正层 | 会话活动、热力、日泳道、未读/归档 |
| 重叠 | 月历、日活动、会话链接 | 月历、日活动、日报/会话链接 | 月历、日活动、会话链接 |
| 独有价值 | 可编辑/可生成的叙述与项目上下文 | 可审证据与人工修正 | 会话时间分布和生命周期治理 |
| 可合并层 | 工作台“回顾”tab、日期导航、二级视图、深链 | 同左 | 同左 |
| 不可合并层 | journal 生成/便签/文章存储 | rollup、features、`.user.json`、写侧订阅 | 会话扫描与 boardExit 自动归档 |

**目标**:workbench 保留 `overview / focus / board / docs / journal` 5 个主 tab,把 journal 显示名改为“回顾”,内部二级视图为“工作日志 / 每日足迹 / 会话活动”。撤 footprint/session-board 左 rail,但不删数据链。

**明确不做**:不把 overview + focus 再合成一页;不把项目任务和文档归类为重复回顾。

## 4.2 session-viewer + structured-session

| 维度 | session-viewer | structured-session |
| --- | --- | --- |
| 会话身份 | 已有 PTY/磁盘会话 | 新建 omp/pi RPC 会话 |
| 交互 | 只读 | 可发送、审批、排队、切模型/思考 |
| 入口 | 磁盘只读 tab、活会话 canvasOverlay、terminal.canvasRow pill | 右 rail 新建独立中央 tab |
| 后端 | profile `readSessionTranscript` | `proc_stream` + piRpc |
| 可统一 | 命名、能力说明、新建入口、转录视觉原语 | 同左 |
| 不可统一 | 不改成可写 RPC;不替代 PTY | 不伪装成 PTY 的模式;不互写身份 |

**目标命名建议**:

- PTY 会话内:“幕布 / 转录”。
- 新建菜单:“RPC 交互会话(omp/pi)”或更用户化的“块式交互会话(omp/pi)”,副标题明确独立会话。
- 不再用一个“结构化”同时指只读转录与 RPC 交互。

## 4.3 approval-inbox + checkpoints + notify-center

| 能力 | 是否待办 | 数据语义 | 合并结论 |
| --- | --- | --- | --- |
| approval-inbox | 是 | 当前 Ask 等待、作答、Ask 历史 | 与 checkpoints 合“处理”面板的“等待”视图 |
| checkpoints | 部分是 | AI 文件改动批次、账本、回退/应用、时间线、文件总览 | 合“处理”面板的“变更”域,保留现有内部视图 |
| notify-center | 否,主要是历史 | Ask/轮次/退出/额度全局流水与回跳 | 独立面板,默认不钉;不是审批第三 tab |

**附加边界**:approval-inbox 自己还有 Ask 历史,不等同 notify 的全局事件流水。两者可以在产品文案上互相链接,不应直接合表或去重。

## 4.4 AI 配置相关能力

| 对象 | 当前宿主 | 是否可统一入口 | 是否可统一存储 |
| --- | --- | --- | --- |
| cli-config | 设置 section | 是 | 否,各 CLI 方言与写适配器保留 |
| skill-hub | 右栏 + 中央 tab | 是 | 否,安装记录/磁盘技能各有语义 |
| mcp-hub | 右栏 + 中央 tab | 是 | 否,多源 MCP 配置写回保留 |
| Magic Context | Memory 面板/控制台/胶囊 | 是 | 否,外部 SQLite 与官方写入管线保留 |
| 原生记忆文件 + lint | “AI配置管理”面板/lint tab | 是 | 否,项目/用户文件与规则写回保留 |
| assets | 设置 + Composer | 是 | 否,全局/工作区资产库保留 |
| session presets | 工作区右键/新建流程 | 只做深链,不迁入全局资产页 | 否,继续存 `session-presets.json` 并含引擎/model/worktree |

**目标**:一个“AI 配置”导航入口和落地页,按“引擎 / Skills / MCP / 记忆与规则 / 智能体与提示词”打开现有管理组件或中央 tab。先统一导航,再决定是否值得做一个巨型共享组件;不要为视觉统一引入新的配置总库。

## 4.5 search + session-search

当前真实结构:

- 左栏一个 SearchHubEntry,列全文、文件快开、会话搜索三项命令。
- search 已有一个 `SearchOverlay`,根据 kind 在 `SearchPanel` 与 `QuickOpen` 间切换。
- session-search 另有一个 `SessionSearchOverlay`,包含自己的遮罩、焦点圈闭、筛选、索引进度和 toast。

**可合并**:浮层壳、焦点/Esc/遮罩、作用域切换、结果行/高亮原语、打开后关闭与跳转反馈。

**必须保留**:

- `Cmd+Shift+F` 全文搜索的回车触发、大小写/glob、文件分组;
- `Cmd+P` 快开的即时 fuzzy、上下键、扫描截断提示;
- `Cmd+O` 会话检索的即时索引、时间/引擎/工作区过滤、行级定位与失效区处理;
- Composer `Cmd+L` 输入历史继续独立,它用于草稿找回而非全局检索。

## 4.6 SSH + WSL + Web 访问

| 能力 | 统一层 | 不可硬并层 |
| --- | --- | --- |
| SSH | 新建来源、远程落地页、设置“远程与访问” | russh、认证、known_hosts、SFTP、转发、远程编辑与事件接线 |
| WSL | 新建来源、远程落地页、设置入口 | UNC/远程宿主、引擎探测、spec wrapper、shell spec、只读文件与元数据迁移 |
| Web 访问 | 设置“远程与访问”、设备/安全入口 | Web 桥、LAN/WAN、配对、风险门、手机连接;不等于 SSH 主机管理 |

**目标**:新建工作区/会话有“本地 / SSH / WSL”来源;右栏一个“远程”落地页按上下文进入 SSH 面板或 WSL tab;Web 访问仍负责手机/浏览器,不塞进 SFTP 面板。

## 4.7 看起来相似但不应合并的功能

- Git 与 checkpoints:版本控制 vs AI 轮次账本;只共享 diff/跳转原语。
- marks 与全文搜索:显式用户锚点 vs 检索;marks 还参与发送与证据链。
- Composer 输入历史与会话搜索:草稿恢复 vs 历史发现。
- 内置终端与 SSH/WSL:可共享会话壳,但生命周期与来源不同。
- session-budget 与 quota:列表露出预算 vs 供应商额度。
- Skills 与 MCP:都可配置 AI 能力,但安装/配置/写回对象不同。
- Memory 与原生记忆文件:共享外部记忆池 vs 各 CLI 原生文件,不能合库。
- 文件预览与 RPC 转录:都可显示块内容,但文件 tab 与实时会话生命周期不同。

## 5. 删除、移出、降层与待验证清单

## 5.1 可直接删除:确定项

| 项目 | 动作 | 保留边界 | 任务 |
| --- | --- | --- | --- |
| 插件市场“在线市场 · 建设中”区块 | 删除可见标题、说明、禁用按钮及死词典/样式 | 不影响内置插件启停、omp 二级市场、本地插件与 `market.local` | A-01 |

不建议在没有逐项证据时设置“批量删除所有试验能力”的任务。占位可确定删除,真实功能必须走以下分类。

## 5.2 建议移出默认内置

### anim

**建议**:转为独立 tmd-anim 入口或可选插件,不再默认占用主客户端。

必须一起处理:

- 左 rail 与动画中央 tab;
- `anim.new-session` / `Cmd+N`,避免删后占用或丢键;
- `AnimRefChips`、send transform、undo、empty-send provider;
- `~/.tmd-anim/projects` 数据保留与外部打开说明;
- 图标装饰、词典、测试和文档引用。

### ports

**建议**:转为可选系统工具插件;若产品明确需要调试工具集,也可只进高级工具而非完全删除。

必须处理:右 rail、中央 tab、可选轮询、进程 kill 路径、工作区归因跳转、词典与测试。kill 属危险动作,移出可减少默认安全与测试面,但不能据此声称无用户价值。

### intent-canvas

**建议**:转可选本地插件或独立能力包,移出默认主客户端。

接触面完整清单:

- 右 rail、`Cmd+Alt+I`、中央 tab、设置 section;
- Composer attachments、AI 作画开关、send transform/undo;
- sessionExited 清理、2s inbox 常驻轮询、OS 通知与回跳;
- 文件树 `.excalidraw` 右键导入与预热 import;
- sidecar 文档、索引、AI inbox/failed、缩略图;
- `@excalidraw/excalidraw` 依赖与构建裁剪脚本。

只保留画布文件但不给打开/导出路径不算完成迁移。

## 5.3 建议降层而非删除

| 项目 | 降层方式 | 保留价值 |
| --- | --- | --- |
| academy | 撤左栏常驻课程卡,在欢迎页/帮助或引擎文档入口可达 | 多 CLI 学习、版本漂移提示和课程注册仍有价值 |
| notify-center | 默认不钉,进入溢出菜单;保留会话/通知深链 | 全局历史与额度/退出回看不是待办 |
| marks | 可默认不钉,保留文件/编辑器/Composer 上下文入口 | 显式锚点和证据链不是独立管理工具 |
| Magic Context 运维 | 状态/记忆文件常用;预蒸馏检查器、访问排行、故障注入、worker 日志进高级 | 主链是记忆命中,不是运维台 |
| session-budget | 改名“列表配额”,入口迁会话/工作区设置或高级弹窗 | 设置值持续生效,禁用 UI 不等于恢复默认 |
| 自建中继 | 设置高级 tab,不作为远程主流程默认步骤 | 本地优先与自控部署有独特价值 |
| 静态壁纸 | 收进“通用”导航组,不单独占一级导航 | 个性化可保留,但不应与核心设置并列 |

## 5.4 待使用证据或产品决策,不能直接判删

| 候选 | 成本 | 需要验证的价值 | 未验证前的保守动作 |
| --- | --- | --- | --- |
| LSP | 语言服务器、下载/生命周期、编辑器集成 | 代码阅读/跳转是否支撑常驻 IDE 能力 | 保留,不新增语言;可评估可选化 |
| PDF/docx/xlsx 内嵌预览 | pdfjs/mammoth/xlsx 依赖与渲染预算 | 是否显著减少跳出应用 | 保留系统打开;按需加载,不直接删 |
| workbench docgen | 队列、调度、生成会话、版本链 | 项目文档是否形成持续使用 | 暂停扩张,入口降高级可评估 |
| 平铺广播 | 多发风险、独立轮次/发送语义 | 多引擎横评是否核心场景 | 保留显式开关与防误发,不改成默认 |
| 自建中继一键部署 | 运维/安全/部署历史 | 目标用户是否依赖自托管 | 降高级,不删协议 |
| 流体壁纸 | WebGL、透底 token、跨表面适配 | 视觉差异化是否值得维护 | 可默认关,不新增效果;产品拍板后收缩 |
| 逐图标颜色/呼吸与多图标组合 | 白名单、词典、形变依赖、全 UI 适配 | 个性化实际使用与品牌价值 | 停止扩张;先减默认展示,不批量清配置 |
| Memory 高级运维 | autoDistill/wiki/控制台复杂度 | 自动记忆是否形成稳定价值 | 高级降层,不禁用后台能力 |

## 5.5 明确保留并集中打磨

- 十家引擎、工作区、会话身份、磁盘回放、重启恢复、归档/删除。
- PTY 幕布、内置终端、Composer 核心触发符/附件/发送契约。
- Ask 检测、审批直达与作答、通知发送/免打扰/历史。
- checkpoints 账本、回退/应用/反悔、变更总览、共同存证。
- Git diff/commit/branch/history/stash/worktree 主链。
- 文件树、文本编辑、Markdown、文件引用、marks。
- session-relay、prompt-enhancer 等直接服务会话的动作。
- 本地插件扫描、信任、权限、版本回退。
- 手机会话、审批、发送、图片、历史、Git、配对与重连。

## 6. 目标信息架构

## 6.1 左 rail:8 → 4

保留:

1. 工作台;
2. 首页;
3. 工作区切换;
4. 设置。

迁移:

- market:设置“系统/插件与扩展”中的入口,`Cmd+Shift+X` 可保留;
- session-board、footprint:工作台“回顾”二级视图;
- anim:移出默认内置;
- academy:本就不在 rail,撤左栏课程卡后由帮助入口承接。

## 6.2 工作台:主 tab 保持 5 个

| 主 tab | 处置 |
| --- | --- |
| overview | 保留,项目概览与默认会话配置 |
| focus | 保留,要处理/接下来 14 天/项目脉搏 |
| board | 保留,任务看板与详情 |
| docs | 保留,项目文档与 docgen |
| journal → 回顾 | 改名并扩二级视图:工作日志 / 每日足迹 / 会话活动 |

这是一种“入口减少、主域不缩水”的方案:左 rail 少 2 个回顾入口,但工作台不额外增加主 tab。

## 6.3 右栏:先治理默认钉住,再合并宿主

建议新装默认钉住为 **5 个面板 + 2 个动作**:

- 面板:文件、Git、处理、AI 配置、远程;
- 动作:内置终端、网络代理。

其他能力:

- notify-center、marks:保留注册,默认不钉,可经溢出菜单/上下文入口打开;
- memory、skill-hub、mcp-hub:管理入口由“AI 配置”承接,原面板可保留兼容但默认不钉,稳定后再撤;
- approval-inbox + checkpoints:合为“处理”宿主;Ask 等待与变更视图并存;
- ssh 面板改“远程”落地,WSL 由远程落地/新建来源进入;
- structured-session:新建入口迁工作区,不再作为右 rail 工具动作;
- ports、intent-canvas:随可选化移出。

**注意**:目标 7 是默认钉住数,不是插件注册总数,也不是删除其余所有能力的 KPI。老用户钉住清单要有一次性迁移或保留策略,不能无声清空。

## 6.4 会话主区:两种会话类型,两种 PTY 视图

```text
PTY/磁盘会话 tab
├─ 幕布(默认,可交互)
└─ 转录(只读,搜索/定位/导出)

RPC 交互会话 tab(omp/pi)
└─ 块式交互、审批、模型/思考、流式转录
```

新建菜单可统一呈现,但 tab 标题、能力和会话身份必须明确。禁止提供暗示“PTY 与 RPC 无损互切”的开关。

## 6.5 设置一级导航:11 个平铺 section → 7 个导航组

| 目标导航组 | 收纳内容 | 原 id 处理 |
| --- | --- | --- |
| 通用 | basic 的外观/行为/打开方式/快捷键;wallpaper 图库与背景 | basic、wallpaper 原样保留 |
| 会话与工作区 | workspace-groups;列表配额、恢复/归档等可作为组内会话动作 | workspace-groups 原样保留 |
| AI 配置 | cli-config、assets 及 Skills/MCP/Memory 管理入口 | cli-config、assets 原样保留;管理能力复用现有入口 |
| 远程与访问 | web-access、ssh、WSL 入口;网络代理可作高级动作 | web-access、ssh 原样保留 |
| 通知 | 通知、声音、免打扰、静音、额度预警 | notify 原样保留 |
| 工作台与回顾 | workbench、journal/docgen/回顾显示偏好 | workbench 原样保留 |
| 系统与数据 | storage、extensions、诊断/高级能力 | storage、extensions 原样保留;intent-canvas 若保留暂归本组高级 |

实现上只给 `settingsRegistry` 增加可选 `navGroup` 元数据,由 `SettingsPanel` 渲染“组 → 原 section → 原 tab”。全部旧 section/tab id、settings.json 和 `openSettingsPanel` 深链保持不变,不需要 id 别名或深链映射。插件禁用仍只移除自己的 section,不回滚或误删同组其他插件的注册。

不为凑数字把不相关设置硬塞同页;组内继续展示原 section 标题和现有 tab,远程徽标、Composer 抽屉等旧深链应自动展开所属组并落在原 tab。

## 6.6 手机端

继续只强化 home/session/history/git 四类主屏及远程续作:

- 看会话和等待状态;
- 发消息、图片、快捷键;
- 处理 Ask、续聊、历史定位;
- 轻量 Git 查看/切换。

不移植工作台、足迹、画布、Memory 运维、Skills/MCP 商店、端口管理等桌面管理面。桌面设置重组不能改 LAN/WAN/配对/设备/安全协议。

## 7. 维护成本与依赖治理

## 7.1 当前代码体量

统计口径:`.ts/.tsx/.rs/.css`,排除 `.test.` 与 `locales`。

| 目录 | 文件数 | 行数 |
| --- | ---: | ---: |
| src/plugins | 1101 | 140271 |
| src/kernel | 227 | 27700 |
| src/app-shell | 40 | 5508 |
| src/mobile | 50 | 7454 |
| src-tauri/src | 211 | 37985 |

主要插件:

| 插件 | 行数 | 成本解读,不是价值排名 |
| --- | ---: | --- |
| workbench | 15768 | 项目/任务/文档/日志/docgen 多子域,合并回顾时需控制继续膨胀 |
| git | 14587 | 核心高价值,优先稳定性而非继续扩功能 |
| files | 11278 | 核心文件链与重型预览混合,适合分域评估 |
| memory-coordinator | 8463 | 多后端、多控制台,适合入口统一与高级降层 |
| intent-canvas | 7727 | 可选化候选,接触面和依赖都大 |
| workspace | 6643 | 核心保留 |
| composer | 4756 | 核心保留,需谨慎处理插件扩展 |
| checkpoints | 4255 | 核心保留,后台装配比 UI 更关键 |
| footprint | 4173 | 回顾合并候选,写侧/修正层必须保留 |
| wallpaper | 3312 | 个性化成本候选,需产品决策 |
| welcome | 3199 | 核心首页,保留简洁 |
| skill-hub | 2806 | AI 配置导航合并 |
| ssh | 2640 | 核心远程后端 |
| mcp-hub | 2549 | AI 配置导航合并 |
| lsp | 2111 | IDE 纵深,待验证 |
| ports | 2056 | 可选系统工具候选 |
| session-viewer | 1962 | PTY 转录主链保留 |
| notify | 1762 | 核心通知链,历史独立 |
| session-board | 1568 | 回顾合并候选,先迁退出归档 |
| structured-session | 1483 | RPC 独立后端保留 |
| anim | 1400 | 可选化候选,Composer 接触面不可漏 |
| academy | 1356 | 帮助降层,不等于课程删除 |

`anim + ports + intent-canvas + wallpaper + academy` 合计 15851 行,约占插件代码 11.3%。**不能把该数写成承诺净删量**:wallpaper/academy 本版可能只是降层,共享组件、迁移和兼容代码也会保留。

## 7.2 依赖分三类治理

| 类别 | 例子 | 动作 |
| --- | --- | --- |
| 核心依赖 | React、Tauri、xterm、必要 Markdown/diff | 保留,关注升级与性能 |
| 可选能力依赖 | Excalidraw、LSP 语言服务、pdfjs/mammoth/xlsx | 随功能可选化或按需拆包;先验证引用再删 package |
| 装饰/扩展依赖 | morphicons、多图标体系、流体 WebGL | 停止扩张,产品决策后收缩 |

删除依赖必须在功能入口、动态 import、构建裁剪脚本、lockfile 和类型引用全部清理后进行;不能只删 `package.json` 一行。

## 8. 数据、生命周期与迁移红线

## 8.1 存量数据不因入口减法而删除

| 数据/状态 | 当前位置或键 | 迁移要求 |
| --- | --- | --- |
| 应用设置 | `~/.tmd-cli/settings.json` | 未识别 id 做白名单/别名处理,不清空其他设置 |
| 工作区 | `~/.tmd-cli/workspaces.json` | 保持 root/身份/归档/恢复语义 |
| 会话预设 | `~/.tmd-cli/session-presets.json` | 留 workspace;提示词 ref 继续按 scope/wsId/name 现读 |
| checkpoints | `~/.tmd-cli/checkpoints/...` | 账本、对象库、states 不动;先迁生命周期 |
| 工作日志 | `~/.tmd-cli/daily/` | 文章/便签/生成产物路径不动 |
| 工作台 | `~/.tmd-cli/workbench/` | 项目/任务/文档/docgen 不动 |
| 足迹 | `~/.tmd-cli/footprint/` | 月 rollup、features、`.user.json` 与补账语义不动 |
| 通知流水 | `~/.tmd-cli/notify-log.json` | 保留历史、去重键与身份快照 |
| Ask 历史 | localStorage `tmd.askHistory.v1` | 合面板不换 key;若换需显式迁移 |
| 面板钉住 | localStorage `tmd.filePanel.pinned.v1` | 一次性默认迁移或尊重用户清单,不无提示重置 |
| 搜索折叠 | localStorage `tmd.search.entryCollapsed` | 共壳不改变三项命令可达 |
| 画布 sidecar | `~/.tmd-cli/intent-canvas/` | 可选化不删;提供打开/导出说明 |
| 动画项目 | `~/.tmd-anim/projects` | 移出客户端不删项目 |
| 壁纸 | `wallpaper.json` + `wallpapers/` | 收缩效果不清图库;关闭时恢复表面 token |
| SSH 信任 | `ssh_known_hosts.json`、主机设置 | UI 归组不改认证/信任存储 |
| Magic Context | 外部 `~/.magic-context/` | 不迁库、不直写,继续官方管线 |

## 8.2 隐藏生命周期必须先迁后删

| 功能 | 隐藏行为 | 硬顺序 |
| --- | --- | --- |
| session-board | 干净退出且已读自动归档 | 先把 boardExit 订阅迁到 workspace 并跑测试,再撤 UI/插件 |
| footprint | checkpoint 封口 rollup、当日刷新、features 写事件刷新 | 先由 workbench 装配写侧并验证单次订阅,再撤旧插件 |
| checkpoints | prompt/edit/turn/exit、4s 磁盘事件、账本写入 | 合面板时保留 activate;不能为隐藏 UI 禁用整个插件 |
| approval-inbox | ask/host 订阅、1.5s 重同步、Ask 历史 | 合宿主后 boot 只能有一份,作答/失败横幅不回归 |
| workbench | journal/docgen 调度、任务卡发送、index watch | 回顾扩 tab 不得重复 attach 或中断生成队列 |
| memory-coordinator | autoDistill/wiki、三个 tab、Composer 胶囊 | AI 导航合并不能禁用整个插件或复制后台装配 |
| intent-canvas | inbox 轮询、OS 通知、发送注入、session 清理 | 可选化时全部随插件退出,不能留下无 UI 的后台写入 |
| anim | Composer transform/undo/empty-send | 移除后其他 chips 发送链仍须工作 |
| ssh | 模块加载重接线、SFTP 事件、远程编辑关闭闸 | 只改 IA,不动后端与会话接线 |
| wsl | 远程来源、spec/shell、UNC 元数据迁移 | 只改入口,不能只保留一张 WSL 卡 |

## 8.3 深链与 id 兼容

重点兼容对象:

- `footprint.daily` / `footprint-daily` 与 payload.day;
- `daily-article:<date>` 与 autoEdit/脏稿闸;
- 工作台 `wb.console`、项目详情和 docs 深链;
- `session-view`、`structured-session`、checkpoint/footprint 证据回跳;
- `skill-hub` 的 view payload、`mcphub` 单例 tab;
- `openSettingsPanel({section,tab})` 的所有旧 section/tab;
- `shell.openMarket`、搜索三命令与现有快捷键;
- 通知/OS 点击、远程徽标、Composer 抽屉面板回退。

推荐做法是“旧 id → 新宿主 + payload”适配,而不是全局搜索替换后让旧入口静默失效。

## 9. 推荐实施顺序

详细任务、文件、验收与回滚见[实施清单](implementation.md)。顺序本身是风险控制的一部分:

| 批次 | 内容 | 为什么此时做 |
| --- | --- | --- |
| A | 占位删除、市场/学堂入口降层 | 无数据风险,先减少明显噪声 |
| B | boardExit、footprint、checkpoints/approval、远程生命周期前置迁移 | 在任何旧插件/入口撤销前建立新责任宿主 |
| C | 工作台“回顾”合并 | 复用 B 的生命周期,保数据与日期深链 |
| D | 处理面板、通知降层、搜索共壳 | 合 UI 不合状态机,风险可独立回归 |
| E | AI 配置统一入口 | 复用现有管理 tab/设置,避免先造巨型配置中心 |
| F | 远程与设置归组 | 配置/凭据风险较高,放在主链稳定后 |
| G | RPC 会话命名与新建入口统一 | 只改 IA,不做 PTY/RPC 身份互切 |
| H | anim/ports/intent-canvas 可选化、壁纸决策、依赖清理 | 产品决策后完整拆贡献,最后清依赖 |
| I | LSP/Office/docgen/自建中继/广播等使用证据评估 | 不阻塞已明确的减法,不无依据判删 |

每个批次应独立可回滚。不要把“入口清理、后台迁移、依赖删除、设置 id 改名”塞进一个不可拆分的大提交。

## 10. 验收指标与回归矩阵

## 10.1 信息架构指标

- 左 rail:8 → 4;academy 不再常驻左栏,搜索仍只有一个人口。
- 新装默认右 rail 钉住:17 → 7;其余保留能力可从溢出菜单或上下文到达。
- 设置一级导航收为 7 组,原 section/tab id 与旧深链不变。
- 回顾一级入口:工作台/足迹/看板 3 → 工作台 1;工作台主 tab 仍为 5。
- 搜索 overlay 壳:2 → 1;三命令与快捷键不减少。
- AI 配置导航:多入口 → 1 个落地入口;各存储与写适配器不变。
- RPC 会话不再与 PTY 工具并列占右 rail,但从新建菜单可达。
- 不再出现无真实能力的“建设中”可见区块。

## 10.2 核心流程回归

- 新建、恢复、重启恢复、归档、删除、续聊与自动归档语义不变。
- PTY 字节透传、Composer 发送、Ask 作答、失败反馈不回归。
- checkpoint 锚点/封口/修订、回退、应用、反悔、转录互跳不回归。
- footprint 封口记账、补账、功能卡修正、日报互跳不回归。
- 日报/便签/docgen 队列、脏稿关闭闸不回归。
- Git diff、提交、分支、stash、worktree 主链不回归。
- RPC 会话发送/审批/断线接续与共同存证不回归;PTY/RPC 身份不混。
- Skills/MCP/CLI 配置写回、备份、未知字段保留不回归。
- SSH 重连/SFTP/转发/远程编辑、WSL 工作区/shell/文件通道不回归。
- 手机配对、重连、发送、图片、审批、历史与 Git 不回归。
- 本地插件信任、启停、版本回退不回归。

## 10.3 工程与体验指标

- 每批运行仓规要求的完整门禁和真实窗口目检,不用单测替代交互验收。
- 对命令、快捷键、设置、词典、图标装饰、localStorage、tab kind 做残留扫描。
- 记录首包、主 chunk、安装包和首开画布/预览的变化,不只看源码行数。
- 记录“新建会话、处理 Ask、审阅变更、找到某日工作、修改 AI 配置”五条任务路径的点击/层级变化。
- 对旧配置、旧钉住清单、旧深链做至少一组存量升级验证,不只测新装。

## 11. 仍需产品决策的事项

1. `anim`、`ports`、`intent-canvas` 的承接形态:官方本地插件、独立仓库/应用,还是彻底停止维护。
2. academy 课程保留在欢迎页帮助、独立指南命令,还是只维护外部文档。
3. 静态壁纸是否保留为高级项;流体壁纸、逐图标装饰和多图标组合收缩到什么范围。
4. LSP 与 Office 内嵌预览是否有使用证据支撑继续默认内置。
5. docgen、自建中继、平铺广播分别是核心高级能力还是可选能力。
6. approval-inbox 与 checkpoints 合宿主后,原插件启停语义如何迁移;不能让用户既有禁用组合产生意外能力开关。
7. 老用户右栏钉住清单是尊重现状只改新装默认,还是提供一次性“恢复精简布局”选择。推荐后者,避免强制覆盖用户习惯。

这些决策不阻塞 A/B/C/D 中已明确且无数据破坏的工作,但会阻塞对应 H/I 任务的最终删除。

## 12. 最终建议

下一版不要平均打磨所有功能,也不要把“减法”理解成把相似名字的功能揉成一个大后端。

最稳妥且收益明确的组合是:

- 删除在线市场占位,市场和学堂降层;
- 把回顾收进工作台,但保留项目/聚焦/任务/文档的独立主域;
- 把 Ask 与 checkpoint 收进“处理”,通知历史独立降层;
- 搜索共壳,AI 配置共入口,远程共导航,设置重归组;
- RPC 会话改名并迁新建入口,绝不与 PTY 做隐式互切;
- anim、ports、intent-canvas 在明确承接形态后完整移出默认内置;
- LSP、Office、docgen、自建中继、广播和重型装饰以使用证据或明确产品决策收口;
- 全程以“数据不丢、后台不断、深链可达、主链更短”为验收红线。

这样才能在减少产品面的同时,保留并加强当前最有价值的“可恢复、可等待处理、可审、可交付、可远程续作”工作流。

# 0.4.2 收敛批规划(特性重叠合并与互跳)

- 日期:2026-10-21
- 状态:已批准(大仙拍板「全做」,分四批实施,每批 review 校准后再开下一批)
- 依据:五路代码侦察盘点(检索入口/沉淀记录/历史 diff/通知额度/会话生命周期)+ CHANGELOG 0.3.3-0.4.1 通读;梳理页 `~/.answer-me-with-html/pages/tmd-cli-0-4-2-特性重叠梳理-20261021-003418.html`

## 背景与目标

0.4.0/0.4.1 两版落地 20+ 特性面,重叠集中于三类:**同层数据抓两遍、同事件沉淀两遍、同内容渲染两套**。0.4.2 定位收敛版:不开新能力面,做互跳、统一数据面与内务收敛。

## 批次

### 批一:互跳(产品可见)

1. footprint ⌘K 检索命中加「在转录中查看」——现在只能跳「日」,复用 kernel `anchorJump` 桥(`openThenJumpToText`,session-search/checkpoints 已是消费方)跳转录行。
2. ~~checkpoints 时间线节点加「看对话」~~ **口径修正(大仙校准 2026-10-21)**:时间线节点本就有「定位幕布」钮(jumpToAnchor,同文多轮 occurrence),梳理页误判缺口;真正残余 = 转录查看器无行级定位桥。大仙拍板当即补:**批一追加已落地**——kernel `sessionViewTabs` 深链加 `locate` 载荷(refresh 重触发),viewer 侧 `locate.ts` 纯函数匹配 user 块(24/14/8 梯队 + occurrence),时间线/审阅单/footprint 三处幕布 miss 落查看器兜底并改判 opened。

### 批二:quota 快照统一

**方案修订(实施时定稿)**:原案「welcome 迁 kernel/quota 注册表」否决——细读后发现 welcome 是**凭据级**盘点(一引擎多账号并列卡),kernel 注册表是**会话上下文级**单账号快照,硬迁会丢多账号面。真重叠底座是 cli-shared `fetchVendorQuota`(三家——welcome 凭据盘 / notify 轮询 / composer QuotaChip 经各 CLI provider——最终都走它)。**落地 = 缓存下沉 vendors 共享层**:(vendor, 凭据, baseUrl) 60s TTL + 在飞合并,只缓存成功(各家退避重试语义不变),三家透明共享零调用方改动。claude 窗口推算(notify claudeWindow 按会话 vs welcome inferClaudeWindow 全工作区)作用域不同,有意不合并。

### 批三:内务收敛(五项)

1. diff 渲染收敛:kernel `patchClassify.ts`(无状态 unified patch 行分类,镜像 git patchModel 判定表)为唯一分类源;checkpoints `BatchFileSection` 与 footprint `DiffPanel` 换用(修掉 `--- `头/`\ No newline` 错分类),git `patchModel` 是有状态真源(行号配对/词级/折叠)保留不并;session-viewer `sv-tool-diff` 数据不同源保留。
2. 状态色表:kernel `gitStatusColor.ts` 字母→语义唯一源;git `STATUS_COLOR` 与 checkpoints `fileChipCls` 各自派生 token 映射(输出零变化)。files 树 `gitDecorateModel` **有意不并**——其字母→色是用户口径逐字母校准(T→树蓝、R→蓝、?→绿),与面板语义不同表。
3. 预设管线:**口径修正**——`launchPresetWorktreeSession` 本就经 deps.create 复用 `runWorktreeCreate` 里程碑回滚链,两文件已是合成管线,侦察高估缺口;真实残留仅 modelArg 拼接 ×2,收敛为 `withModelArg` 唯一实现。
4. 搜索浮层:kernel `splitHits.ts`(多命中切段原语)上收,search SearchPanel 与 session-search SnippetText 共享(session-search 从单命中升级全命中)。三面浮层壳(宽度/底色/圆角/阴影)**有意不并**——参数化壳 = props 动物园且视觉漂移风险实。
5. 沉淀读侧:memory-coordinator `exitedReads.ts`——wikiHook 与 autoDistill 的 `readSessionUserMessages(full)` 同会话同刻共享一次磁盘读(TTL 30s 在飞记忆,只去重读不碰幂等/门控/写路径)。**ckptTurnSealed 半项误报**:全仓实证消费方只有 footprint(自家 rollup+刷新信号),journal 不订阅,无双读可消。

### 批四:留账

1. 0.4.1 轮询面审计 D 档 2 处短周期裸 setInterval 事件化。**已落**:sessionStatus 无活跃停表 + 活动时间戳去重闸(读成功才记位,失败保重试);SessionRows 复核已有消费者计数熄表,零码量记档(详见 poll-audit D 档处置结果)。
2. @phosphor-icons barrel 冷加载全仓专项(0.4.1 tabClose 打桩 42s→3.2s 的根因尾巴)。**已落**:`scripts/vite-phosphor-deep.mjs` vite 插件(pre-transform)把全仓 312 条 barrel 命名导入改写为逐图标 `dist/csr/*` 深路径(904 个值导入全转换零缺失;`XxxIcon` 后缀别名映射裸名 import as;IconContext 走 `dist/lib/context`;纯类型导入留 barrel 由 esbuild 擦除)。实测 dev 冷加载 phosphor 网络字节 ~14MB barrel → 18.7KB 按需 23 模块,barrel 零拉取;79 个 svg 图标渲染目检过;mobile 构建同插件实证。prod 产物不变(barrel 本就 sideEffects:false 摇树)。

## 方案取舍

- **合并 vs 保持独立**:7 项明确不动——session-budget(会话列表条数预算,与额度无关,仅命名撞车,建议后续改名消歧义)/ storage-audit 与 worktree 占用列(不同 Rust 命令不同粒度)/ composer ⌘L 与 session-search ⌘O(回填草稿 vs 找会话,对象不同)/ marks(文件内锚点独占)/ welcome 与 workspace 起会话(同链不同入口,保留)/ 归档三语义(已统一 kernel 覆盖层)/ wiki·日报·功能卡(项目·日·月三粒度产品面保留,只做读侧合一)。
- **时间线并入转录 vs 互跳**:选互跳(时间线留右栏作导航面,节点补「看对话」),不把时间线塞进转录视图——前者改动小且保留两场景。
- **沉淀三面合一 vs 读侧合一**:选读侧合一。wiki(项目决策)/日报(日粒度)/功能卡(月粒度)服务不同回看节奏,产品面不动。
- **diff 渲染收敛范围**:只并「unified patch 文本→着色行」三套;session-viewer 是字符串对 diff(转录内嵌),数据不同源,强并收益低。

## 验证

- 每批:`pnpm check:gate` 全链 + `npx react-doctor@latest -y` 100 分 + 提交信息按仓库规范。
- 批一 UI 行为:1421 浏览器桩目检互跳两条路径。
- 批间:review 校准后才开下一批。

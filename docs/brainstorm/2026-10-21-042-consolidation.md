# 0.4.2 收敛批规划(特性重叠合并与互跳)

- 日期:2026-10-21
- 状态:已批准(大仙拍板「全做」,分四批实施,每批 review 校准后再开下一批)
- 依据:五路代码侦察盘点(检索入口/沉淀记录/历史 diff/通知额度/会话生命周期)+ CHANGELOG 0.3.3-0.4.1 通读;梳理页 `~/.answer-me-with-html/pages/tmd-cli-0-4-2-特性重叠梳理-20261021-003418.html`

## 背景与目标

0.4.0/0.4.1 两版落地 20+ 特性面,重叠集中于三类:**同层数据抓两遍、同事件沉淀两遍、同内容渲染两套**。0.4.2 定位收敛版:不开新能力面,做互跳、统一数据面与内务收敛。

## 批次

### 批一:互跳(产品可见)

1. footprint ⌘K 检索命中加「在转录中查看」——现在只能跳「日」,复用 kernel `anchorJump` 桥(`openThenJumpToText`,session-search/checkpoints 已是消费方)跳转录行。
2. checkpoints 时间线节点加「看对话」——审阅单(BatchSheet)已有同款,时间线节点补齐,复用 `seeConversation` 同文多轮按出现序定位。

### 批二:quota 快照统一

kernel/quota 注册表加 TTL 快照缓存;welcome QuotaPanel(现为 `credentials.ts` 直连 vendors,绕过注册表)迁入;notify 轮询 / composer QuotaChip / welcome 三家同吃一份快照,消同一供应商窗口双抓。

### 批三:内务收敛(五项)

1. diff 渲染收敛:git `PatchLines` 抽共享 unified patch→着色行渲染,checkpoints `BatchFileSection`(裸 split 逐行)与 footprint `DiffPanel`(classifyLine)换用;session-viewer `sv-tool-diff` 数据不同源(字符串对),保留。
2. 状态色表三合一:checkpoints `fileChipCls` / git `statusColor` / files `gitDecorateModel` 并一张语义表。
3. 会话预设管线合一:`presetLaunch.ts` 与 `worktreeCreate.ts` 平行实现的 spawn+初始提示词+identityTrack 合成一条管线,worktree 复用。
4. 搜索浮层壳合一:search 与 session-search 各自的浮层壳+子串高亮原语共享,入口保留。
5. 沉淀钩子读侧合一:`kernel.sessions.exited` 的 wiki 与 autoDistill 订阅共享一次尾段读取(写家各自保留);`ckptTurnSealed` 的 footprint/journal 双消费同理。

### 批四:留账

1. 0.4.1 轮询面审计 D 档 2 处短周期裸 setInterval 事件化。
2. @phosphor-icons barrel 冷加载全仓专项(0.4.1 tabClose 打桩 42s→3.2s 的根因尾巴)。

## 方案取舍

- **合并 vs 保持独立**:7 项明确不动——session-budget(会话列表条数预算,与额度无关,仅命名撞车,建议后续改名消歧义)/ storage-audit 与 worktree 占用列(不同 Rust 命令不同粒度)/ composer ⌘L 与 session-search ⌘O(回填草稿 vs 找会话,对象不同)/ marks(文件内锚点独占)/ welcome 与 workspace 起会话(同链不同入口,保留)/ 归档三语义(已统一 kernel 覆盖层)/ wiki·日报·功能卡(项目·日·月三粒度产品面保留,只做读侧合一)。
- **时间线并入转录 vs 互跳**:选互跳(时间线留右栏作导航面,节点补「看对话」),不把时间线塞进转录视图——前者改动小且保留两场景。
- **沉淀三面合一 vs 读侧合一**:选读侧合一。wiki(项目决策)/日报(日粒度)/功能卡(月粒度)服务不同回看节奏,产品面不动。
- **diff 渲染收敛范围**:只并「unified patch 文本→着色行」三套;session-viewer 是字符串对 diff(转录内嵌),数据不同源,强并收益低。

## 验证

- 每批:`pnpm check:gate` 全链 + `npx react-doctor@latest -y` 100 分 + 提交信息按仓库规范。
- 批一 UI 行为:1421 浏览器桩目检互跳两条路径。
- 批间:review 校准后才开下一批。

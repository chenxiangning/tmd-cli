# 会话行 tok/s pill 稳定性与口径修复设计(治「时隐时现 + 2 tok/s」)

日期:2026-10-03
状态:已实施(门禁全绿:typecheck / 457 文件 3580 测试 / arch-boundary / file-size /
build / react-doctor 100;omp·claude·codex 真实数据回放达标;UI 目检留用户)

## 背景与目标

用户观察:工作区会话列表活会话行的 tok/s pill 数值老是不稳——时而消失、时显离谱小值
(如 2 tok/s)。本机 16 个真实会话文件(omp 8 + claude 8,254+ 相邻 usage 对)灌入与
pill 逐行对齐的模拟器实证,三个根因按贡献排序:

1. **分子口径错位(主因)**:omp/pi/claude/qoder 的 usage 行是**每消息增量**语义
   (连续 output 值随机起伏,单调性 51:49;累计型应≈100%),而 `recentTokPerSec`
   按 `b.output − a.output` 差分——差分只对 codex 累计快照成立。实测:51% 的相邻对
   分子 ≤0 → null → pill 消失(时隐时现的全部主因);正差分对也系统性低估
   (中位 17.9 vs 正确分子 31.8 tok/s);`(250−149)/49.2s = 2.0 tok/s` 正是截图形态。
2. **两点瞬时差分无平滑**:每来一条消息样本整组更换,分母含排队/首字等待/思考/工具
   执行(轮内 Δts p50=10s、p90=48s),相邻显示值跳变比 p50=2.5x、p90=16.2x。
3. **跨轮污染**:轮始首拍「末两行」常是上一轮残余(12/500 对夹真实用户输入,
   gap 51s~21min),Δts 混入轮间空闲 → 显极小脏值。

顺带两个事实修正与发现:500ms 聚簇闸本机实测零命中(降为防御性);claude 短会话
64KB 尾窗内 usage 行常 ≤1 行,差分无从算起;claude 新版 `usage.speed` 字段是字符串
档位("standard")非数值,弃用。

目标:pill 数值稳定(不闪灭、不大幅跳变)、口径诚实(维持「端到端响应均速,含排队
与首字等待,偏保守」的既有语义与 tooltip 文案)、codex 从「永不显示」改为正确支持。
非目标:协议级精确吞吐计量;CSS/文案/交互形态打磨。

## 方案取舍

选定(**方案一:cli-shared 纯函数层重写估算,pill 只换调用**),与真实数据回放对照:

| 方案 | 可显率 | 中位值 | 跳变比 p50/p90 | 取舍 |
|---|---|---|---|---|
| 现行(末两行差分) | 50% | 17.9 | 2.5x/16.2x | 根因本体 |
| 只修分子 | 100% | 31.8 | 1.5x/4.9x | 跳变仍大,轮始脏值仍在 → 否决 |
| 修分子+host 轮状态过滤 | 93% | 31.9 | 1.5x/5.3x | 需新增 kernel 状态;SSH 远端会话时钟域不同有钟偏风险 → 否决 |
| **修分子+轮种子+近 5 对滑窗** | **97%** | **34.4** | **1.1x/2.0x** | **选定** |

被否决另案:估算逻辑搬进 pill 组件(workspace 是 feature 插件,消费 CLI 格式知识须走
cli-shared,违反 AGENTS.md 准入规则)。

关键决策:

- **分子按行型分派**:增量行 = `b.output`;codex 快照行 = `b.output − a.output`。
  `UsageLine` 增可选 `snapshot` 标记(parseUsageLine 本就产出该信息,落进行对象)。
- **轮种子取自尾窗自身**:`lastUserTurnSeed(head)` 识别最后一条真实用户输入行
  (`message.role=="user"` 且 content 非工具结果,claude/qoder 与 omp/pi 同型;codex 为
  `event_msg/payload.type=="user_message"`),与 usage 行同一时钟域,SSH 无钟偏。种子
  之前整轮剔除 + `(提交→首条完成)` 本身计一对样本 → 第一条消息完成 pill 即亮
  (顺带缓解 claude 行少问题)。cli-shared 准入先例:跨 ≥2 家 CLI 家族的磁盘格式知识。
- **单对 Δts 上限 180s**:实测轮内误伤 1.2%(p90=48s),种子不在窗内时兜底挡跨轮
  残余;下限 500ms 保留(防御攒批,虽本机零命中)。
- **滑窗 = 最近 ≤5 个有效对** `Σ分子 ÷ ΣΔts`:跳变 p90 收敛 16.2x→2.0x。
- **codex 支持**:`extractUsageFromHead` 加可选参数 `snapKeep`(默认 1,行为不变;
  welcome/session-search 零感知),pill 传 2 → 快照差分生效。种子仅配增量型;
  快照对要求两拍都在种子之后(快照是会话累计,跨轮差分含上轮末值)。
- **单对速率可信上限 300 tokS**:`SPEED_PAIR_RATE_CAP`——实施期实证发现 codex 快照
  对存在 bundled 刷盘 artifact(短间隔对捆绑整段爆发 token,本机 1453 个有效对中
  >300 占 2.8%,p99=654,极值 1165;真实 API 输出上限 ~250),超限弃对,与既有
  「宁缺勿爆」同源。
- **不变项**:2s 巡航、64KB 尾窗、尺寸闸粘滞显示(文件未变保旧值)、STALE_MS=10min、
  `Math.round`、CSS、tooltip 文案(「响应均速(含排队与首字等待,偏保守)」新口径下
  依然诚实)、dsh 空路径不喂假路径、未绑定磁盘身份不显示。

## 验证

- 纯函数单测(sessionUsage.test.ts 重写):增量分子(负/零差不再吞)、种子对、
  180s cap 剔除、滑窗只取末 5 对、codex 双快照差分、snapKeep=1 默认回归、
  500ms 攒批丢弃、lastUserTurnSeed 三型行(omp 字符串 content/claude list 含与不含
  tool_result/codex user_message)与无用户行 null。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size
  && pnpm build` + `npx react-doctor@latest -y`(100 分)。
- 真实数据回放(新实现 esbuild 打包后直跑本机会话):omp 392 文件 59022 刷新点
  可显率 49%→**100%**、中位值 15.3→28.0、跳变比 p90 19.4x→**1.5x**;claude 37 文件
  232 刷新点可显 **98%**(种子对生效,短会话 1 条 usage 行即可显示);codex 200 文件
  107 刷新点可显 **68%**(artifact 对按守卫弃),尖峰 942/1165 全灭,样本值落在
  1~77 tok/s 合理区间。
- UI 目检(仓库铁律):`pnpm tauri:dev` 起真实会话观察 pill 亮灭节奏与数值稳定,
  留给用户在真机执行。

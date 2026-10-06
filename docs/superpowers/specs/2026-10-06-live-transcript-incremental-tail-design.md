# 活会话转录浮层增量尾读设计

日期:2026-10-06
状态:已实施(单测 + 门禁全绿;桩目检受活会话桩配方限制,验证面见「验证」节)

## 背景与目标

liveOverlay(结构化视图浮层)此前每拍(1s 探测短路)在文件变更时全量重读转录文件并整体
重新解析:超大转录(8MB+)每秒约百毫秒主线程占用(ponytail 注释自报天花板,见 2026-09-30
live-transcript-view 设计的遗留项)。目标是把「变更拍」改为增量段解析:只读上次对齐偏移之后的
字节,行级解析新增行,跨拍累计原始块后全量 pair——大转录活视图不再有周期性卡顿。

非目标:不动查看器 tab(viewerTab)的全量读取;不做 token 级流式(JSONL 是 message 级落盘,
无 token 粒度);不给非 JSONL 家族(dsh zstd 盘 / opencode sqlite)做增量。

## 方案取舍

| 方案 | 取舍 | 理由 |
|---|---|---|
| **契约暴露 + 壳层实现(选定)** | CliProfile 加可选 `readTranscriptTail(session, since)`;cli-shared 壳(readTranscriptTail + makeTranscriptTailReader)统一实现行对齐与增量读,JSONL family 一行接线 | 增量知识(行对齐/残行回退/轮转守卫)集中一处;family 只提供 lineOf(已有);未声明家族自动回落全量,零破坏。接线面 = claude/codex/omp·pi/qoder 系;kimi/grok 目录型会话被浮层能力门(pillCapable)拦截不出钮,不接(门开时再带路径解析一并接) |
| liveOverlay 层自己拼(否决) | 浮层直接 import 各 family 的 lineOf + 自己做 IO | 浮层要知道每个 family 的文件路径规则(grok 目录型),单插件长出 CLI 知识;契约不进 kernel,下次消费方(如手机 transcript)要再抄一遍 |
| 改 Rust 原语语义(否决) | 给 fs_read_range 的 at_eof 残行分支改 consumed 对齐 | 会动时间线(现有消费方)语义;且壳层回退计算便宜(只编码残行段),不动原语更稳 |

关键设计点:

1. **行对齐续读偏移**:窗末完整行 → offset = 窗末;残行 → 回退到残行行首(残行段 UTF-8 字节
   数,TextEncoder 只编码残行,便宜)。上拍跳过的半行补全后从行首重读,不丢消息。
2. **跨拍累计 + 全量 pair**:增量段工具结果块要与上拍的调用块配对(pairToolResults 语义),
   因此累计原始块(未 pair)在组件 ref(LiveTailState),每拍对累计全量 pair(万级块线性扫,
   亚毫秒)。
3. **轮转守卫**:文件 size < 上次 offset = 文件被重写,增量偏移失效,since=null 全量重来。
4. **truncated 首读定格**:增量拍不携带 truncated(undefined),不冲掉首读(全量拍)的截断标记。
5. cli-shared 准入:session-viewer(feature 插件)联合消费转录格式知识,import 处注释声明先例
   (AGENTS 准入标准的缝隙层条款)。

## 验证

- 单测:`src/plugins/cli-shared/sessionTranscript.tail.test.ts` 10 例(全量起步/残行回退/段尾
  残行对齐/32MB 截断/读失败/壳默认 session.path/跨拍 pair/轮转守卫/truncated 定格/全量回落)+
  既有 sessionTranscript.test.ts 不回归。
- 门禁:typecheck / vitest 全量(468 文件 3670 测试)/ check:arch-boundary / check:file-size /
  check:i18n-keys / build / react-doctor 100 全绿。
- 桩目检限制如实声明:浏览器桩环境「欢迎屏 → 主界面」切换链(session spawn 后 host 装配)
  为桩配方固有缺口,本次未打通;已验证部分 = app 全量起、探针全绿、无新 crash。UI 行为面
  (浮层打开/渲染/贴底跟随)未动,数据装配换函数由 typecheck + 单测兜底;真机复验建议随
  0.3.1 真机清单(开一个 8MB+ 大会话的结构化视图,观察滚动跟手度)。

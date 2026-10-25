# 32 · 0.4.2 收敛批与幕布滚动位家族契约

日期:2026-10-21 · 状态:已落地(0.4.2;2026-10-22 发版评审补回放包络剥除与属主守卫,见 docs/review/2026-10-22-042-release-review.md)

0.4.2 四批收敛 + ports 插件 + 幕布跳顶根治的契约沉淀。规划口径见 `docs/brainstorm/2026-10-21-042-consolidation.md`。

## 幕布滚动位家族(kernel/terminal*)

跳顶根因链:开合面板 → 大缓冲同步重排(ResizeObserver 一拍 2-3 连发)→ 主线程长阻塞超 render_health 4s 死限 → 误判悬死 reload → 重挂回放 vp=0。四层防御,全部在 kernel,单会话实例随 keep-alive 常驻:

| 件 | 职责 |
|---|---|
| `terminalScrollKeeper.ts` | 快照-恢复(隐藏期 vp 打回 0 的 WebKit 重置)+ 重排内容锚(raf 延帧落锚 + 比例估计)+ enforcement 窗(~800ms 每帧钉扎,用户 wheel/pointerdown/touchstart 即让位)+ 重印守望(缓冲坍缩 ≥50% 判抹除,连续 3 拍同长判落定,按 24 字符归一锚文全缓冲重锚);卸载 `dispose()` 收 timer/rAF/监听 |
| `terminalSigwinchGuard.ts` | SIGWINCH 舞步降级(唯一字节透传例外,2026-10-25 起扣留待确认):`host.resizeSession` 前后 arm ~2.5s,窗内见 `1049h` 先**扣留(hold)不产出** —— 真交互式 alt UI(模型选择器/fzf)与舞步同以 1049h 开头且驻留无 1049l 闭合,立即丢弃会吞掉 picker 帧并滞留丢光后续输出(实证 omp /model:1049h+13KB 帧驻留,幕布卡死);见 `1049l` 确认舞步才丢弃 alt 段(放行会与内联重画并排成两份同帧)+ 注入 rows-1 换行(内联重画落空白区)+ 剥尾;**确认窗(800ms)尽未见 1049l = 真 alt,hold 经 emit 出口原样奉还**(terminalStream 注入,与实时字节同路保序;未注入时退化为 feed 被动超时)并 disarm(交互态内后续 1049h 不再扣)。tail 相预算(32B)内搜寻 3J 签名,1049l 与清屏间的实测前奏(`\x1b[0m`+OSC8 闭合,帧内无超链接时缺省)一并吞剥,预算尽未见 3J(vim/fzf 真 alt)`pending` 原样奉还零损失,tail 相 10s 停滞自愈;窗外 alt 原样放行;半截 token 跨块扣留(splitCarry,MAX_TOKEN=8);卸载 `dispose()` 清确认 timer |
| `terminalSigwinchGuard.stripDanceEnvelopes` | 回放面同律:outputBuffer/磁盘 journal 存原始字节,全量回放三源(memoryReplay/增量/磁盘尾)过「1049h…1049l + 尾清屏含 3J」整体包络剥除;3J 是舞步签名,vim 退 alt 不清滚动缓冲故保留 |

## 转录定位桥(kernel sessionViewTabs + session-viewer)

深链 `payload.locate { text, occurrence }`:viewer 侧 `findBlockIndex` 按 24/14/8 字符梯队 + occurrence 计数匹配 user 块,越出已渲染批次由切片帽扩大覆盖;幕布 anchorJump miss 落查看器兜底后改判 opened。消费方三处:footprint ⌘K「看对话」(jumpTranscript)/ checkpoints 时间线与审阅单(seeConversation,按批序传 occurrence)/ 转录查看器 viewerTab。防重放闸键 = payload.locate 对象引用(新深链必新对象,分批重渲引用不变)。

## quota 供应商快照缓存(cli-shared/quota/vendors)

`(vendor, cred, baseUrl)` 键 60s TTL 快照 + 在飞合并(promise 共享),只缓存成功(退避重试语义不变);force 通道跳过缓存读与在飞合并。**在飞属主守卫**:then/catch 回写与删表前校验 `snapInflight.get(key) === p`——force 顶替后迟到的旧 promise 只回自身调用方,不得用新时间戳回写旧数据(污染整个 TTL 窗)、不得误删后继登记。消费三面:welcome 凭据盘 / notify 低水位轮询 / composer QuotaChip。

## kernel 唯一源收敛

- `patchClassify.ts`:无状态 unified patch 行分类唯一源(checkpoints/footprint 换用;git patchModel 有状态真源保留不并;session-viewer 字符串对 diff 不同源不并)。
- `gitStatusColor.ts`:字母→语义唯一源,git/checkpoints 各自派生 token 映射;files 树逐字母校准表有意不并。
- `splitHits.ts`:多命中切段原语,SearchPanel 与 session-search SnippetText 共享(session-search 升级全命中)。
- `withModelArg`:预设模型旗标拼接唯一实现。

## ports 插件(零 Rust 扫描)

平台分派 procCommunicate:lsof(macOS)/ ss→netstat(Linux)/ netstat+PowerShell Get-NetTCPConnection(Windows),命令全 args 数组零拼接。归组 = ppid 链上溯到监听顶层(同 pid 多端口按 g.top 引用收组;**pid null 恒顶层**,null 作 Map 键会假家族——2026-10-22 评审修复);kill 两段 SIGTERM→SIGKILL(Windows taskkill /T)。注册面 = activate(ctx) registerTabContent + registerSidebarAction,插件计数 47→48。

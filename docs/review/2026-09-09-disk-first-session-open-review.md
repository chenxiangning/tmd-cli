# 磁盘会话先行回放 spec 对抗评审(走法 1)

- 日期:2026-09-09
- 状态:已完成(7 项发现全部处置,spec 修订为 v2;结论 = 修订后可实施)

## 评审方式

双轨:主会话自审(核心链路源码核读 + autoActivate 消费方全库 grep)+ 独立 reviewer 代理九维对抗审查(时序竞态/回放源/指针文件/askWatch/状态机红线/就绪锁/拆除清单/Rust 面/测试盲区),证据均落到文件:行。

## 发现与处置

| # | 严重度 | 问题 | 处置 |
|---|---|---|---|
| F1 | P1 | v1「附加项:webview 重载空幕布修复」前提错误——tab 无跨重载持久化(`sessionTabs.ts` 纯内存),「boot 恢复 tab」不存在 | **接受,附加项撤销**;若将来做 tab 持久化,恢复应走 `session_history_page` 按 tmd id 直读,单独立项(spec 方案取舍 F) |
| F1p | P1 | 「<300ms 出画面」按可见画面计量不可达:回放尽还要等 500ms 静默撤罩,CLI 首字节 1–3s 后才到,实际可见 ~1s | **接受**:磁盘回放分支回放完成即撤罩落就绪锁(墓碑帧即内容),内存分支维持现状;口径保持 <300ms |
| F2 | P1 | StrictMode 双挂载 + 消费即删 = 二次挂载槽空回放丢失 | **接受**:消费不删槽,槽只被下次 prefetch 覆盖;亚秒连开两会话丢先者回放,记为接受降级 |
| F3 | P1 | 预取 promise 异步 vs `terminalReplay.ts:99` 同步读:promise 未决期走 else 直写会导致实时字节与回放交错 | **接受**:spec 增「异步接缝」节——挂载起 liveQueue 即攒队,resolve 后选分支 |
| F4 | P2 | 回放窗内 composer 作答(不经输入闸)清候选后,restoreTail 晚到立新候选 → 静默升级假 waiting | **接受**:restoreTail 增写后闸(距 lastWriteAt < 8s 跳过,约 4 行) |
| F5 | P2 | askProbe「双源打架」理由基本被状态机互认挡住;且 loadProgress 是 React state,1Hz interval 闭包读不到 | **接受**:停采保留但理由改写为收口;实现须经 ref |
| F6 | P2 | Rust 措辞:目录是 slug(profile_id) 非「引擎」;离线读 startOffset/hasMore 是假绝对偏移;指针内容无信任边界校验 | **接受**:措辞修正 + 契约「消费方只准用 text」+ max_bytes clamp ≤1MB + 路径分隔符校验 |
| F7 | P2 | 删 silent 后 activate:false 零调用方,与 clean cutover 矛盾 | **接受**:activate/silent opts 整体删除,去重分支恒聚焦;相关契约测试改写(清单进 spec 拆除节) |

## 事实冲突裁决

- 前置任务 P0-3(restoreTail 自愈闸桩复现):侦察兵报告「restoreTail 刻意不推 bytesIn」,评审员核 `askWatchCore.ts:96-99` 为正常推入、自愈判据与 bytesIn 无关。**采评审员**(给了逐行证据),P0-3 销,真实风险转为 F4 的写后闸进设计。
- 自审补充(评审员未单列):autoActivate 拆除清单补全至文件:行 级(含 `FEATURES.md:29`、`BehaviorTab.tsx:23,242`、locales 三条文案),已并入 spec。

## 结论

spec v2 可实施。剩余开放项与设计本身无关:①「点击即后台 spawn」语义确认;②辅线三件套是否随行。

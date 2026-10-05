# 幕布假死第十一轮提交收口复审(368499a3)

- 日期:2026-10-04
- 状态:已完成(提交纯净性审计 1 实锤留档不返工;代码自审 8 项全过;门禁全绿双回执)
- 范围:368499a3「fix(render-health): 泵侧后台慢拍降档+镜像feed互斥与卸载补种+幕布数据链停滞探针,治幕布假死第十一轮」全部 27 文件(代码 21 / spec 1 / 文档 5),含同树并行的 de390435、d61dcf8e(checkpoints 时间线两钮)在门禁树内的覆盖确认
- 性质:提交收口复审 + 实施自审(修复本体设计取证见 specs/2026-10-04-canvas-stall-pump-background-design.md 与 architecture/17 第十一轮增补段)

## 结论先行

修复主体在 368499a3 落下,代码部分与门禁验证树**逐字节一致**(收口时 `git status` 对 src/ 零残留 —— 修复实施与验证在同一棵树上完成后才被提交);提交纯净性一条实锤:并行进行的「文档对码 v0.2.9」WIP 有四片(architecture/01·02、FEATURES 头段、README 索引列)混入本提交,内容经逐条复核与第十一轮事实一致(如 02 的「命令面 165 = +session_set_viewed」),拆分返工收益为零,留档不返工;文档对码的其余主体(FEATURES 增量域正文 / 对码评审记录)仍在工作树由其自身收口,本提交未裹挟。

## 提交内容审计

| 审计项 | 结论 |
|---|---|
| 代码完整性 | 21 文件 = 第十一轮全部改动(Rust 6 + kernel 15),无遗漏无多余;`git status` 对 src/ 零残留 = 提交树即验证树 |
| spec 与索引 | specs/2026-10-04-canvas-stall-pump-background-design.md 随提交落下;docs/README.md 索引行同步在册 |
| 架构沉淀 | architecture/17 第十一轮增补段随提交;停滞探针描述为最终实现口径(getOutputBufferBytes 变化,锚无关;实施中途从 lastActivityAt 口径改判据后文档已同步) |
| 纯净性 | ⚠️ 实锤留档:混入文档对码 WIP 四片(01/02 全量校准、FEATURES 头段 7 行、README 01/02/FEATURES 索引列)。对照先例 d2c67ccc(提交纯净性与扣分项归属取证),本次复核:混入内容全部为事实性校准且含本轮自身(命令面 +1 即 session_set_viewed),归属可辨、无冲突语义,不返工 |
| 同树旁支 | de390435/d61dcf8e(checkpoints)先于本提交落地,门禁树含其改动 —— 3588 前端测试回执覆盖之 |

## 代码自审清单(实施风险点逐项复核)

| # | 风险点 | 复核结论 |
|---|---|---|
| 1 | viewed 标记生命周期 | TerminalView 激活/失活/卸载三口打点;webview 重载 readopt 复位(sessionAdopt.readopt.test 断言在案);StrictMode 双挂载幂等(IPC 打点无状态) |
| 2 | render_health 新增 active 必填参数 | 全仓唯一调用方 rafFallback 已同步随行;桥/浏览器桩路径 report() catch 静默,不回归 |
| 3 | 泵侧 effective_window | 只动事件节拍:日志按批落盘字节不变、1MB 批上限不变、前台 8-50ms 原样;后台 250ms 与前端合帧/镜像采样同拍;pty_spawn_tests 钉前台透传/后台钳制两断言;SSH 通道 no-op(session_set_viewed 对 russh 会话查表 miss,幂等无害) |
| 4 | 镜像 feed 互斥 + reseed | TerminalView 清理序:先补种后注销 handle(feed 互斥期内无活字节插队);reseed 同步直写不经 ready 门(规避 querySize 在途竞态);空幕布不养镜像;CLI 闸进镜像 ctor 谓词,feed/reseed 共用,appendOutput 内联闸拆除(语义等价,未知会话两版同喂) |
| 5 | 停滞探针 | 「在流」真相取 getOutputBufferBytes 变化(锚无关 —— activity.lastActivityAt 未锚定会话恒 0 不用;压实回落也算变化);rAF ≥4s 退出归守望阶梯;30s 重建冷却;重建(canvasGen)后 lastLiveAt/streamReady 随 effect 复位,新探针首拍只基线不触发;canvasStall.test 6 例钉边界 |
| 6 | terminalReplay onLive | 攒队/合帧/直写三分支统一入口戳(停滞探针活性真相不因隐藏合帧失真) |
| 7 | 收纳拆分 | terminalCanvasHealth.ts 新件(askProbe 迁移 + stallProbe 接线 + buildReseedScreen);TerminalView 299 行铁则内;行尾 \r\n join 无尾随换行(尾随换行会把末行滚出 scrollback=0 物理屏) |
| 8 | 权限登记 | sessionSetViewed 归 ipc.terminal(pluginPermissions.grants 穷尽性测试过) |

## 门禁回执(收口时全量重跑)

- 前端:typecheck / vitest 459 文件 3588 用例全绿 / check:arch-boundary / check:file-size / build(tsc+vite+字体语言裁剪)
- Rust:cargo test 339 通过 / clippy --all-targets -D warnings 零告警 / fmt --check
- 收口铁则:react-doctor 100/100(双回执:实施完成时 + 收口复审时)

## 留观与已知天花板

1. **真机验证待重构建**:打包实例(0.2.9)与 dev 实例运行的都是旧代码,`tauri:build` 后才吃到本修复;重点盯两个历史高发场景 —— 多会话并发整夜挂机、窗口遮挡后回前台。
2. SSH io 通道(russh select 循环)未做后台慢拍:无现场证据指向 SSH 洪水;session_set_viewed 标记已埋,后续有证据再动。
3. 整条 appendOutput 链死亡(Tauri 事件监听器本身死)从 JS 侧原理性不可测 —— 停滞探针只覆盖「链活着、幕布局部断供」类;链死类的传感器只能在 Rust 侧(泵 emit 成功 ≠ webview 消费),留待有证据再立项。
4. occlusion → 全会话降档最长 10s 延迟(active 随 render_health 上报,受 stuck 10s 去重节拍约束);吊销窗口是分钟级,可接受。冷启动后 ≤5s 内激活幕布暂走慢拍(首拍心跳对齐 active),自愈。
5. 双实例共用 `~/.tmd-cli`(打包版 + dev 同跑)属现场卫生问题,建议留一个;非本修复义务但影响观察信度。

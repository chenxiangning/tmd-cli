# 幕布假死第十一轮:泵侧后台慢拍 + 双份解析消除 + 数据链停滞探针

- 日期:2026-10-04
- 状态:已实施(门禁全绿;真机长时观察留用户)

## 背景与目标

用户报告幕布假死复发(第十次修复后频率降低但未根除)。本轮**不猜**,直接对正在运行的打包实例现场取证:

1. **活体洪水实锤**:`~/.tmd-cli/session/omp/...` 三个会话 9 分钟 55MB(≈100KB/s)、31 分钟 41MB、127 分钟 22MB —— omp 状态动画(spinner + 「slug 桶工作表」走马灯 + 进度条)以 15-20tick/s 整帧重绘,持续整个轮次(数十分钟)。daily-journal 治的是「后台生成会话」这个特例,用户前台正常工作会话本身仍是洪水源。
2. **主线程饱和实锤**:对打包实例 WebContent 进程 `sample` 5 秒 —— 主线程 ~43% 样本在 `RemoteLayerTreeDrawingArea::updateRendering`,其中 ~29% 在深嵌套 flex 布局 + 文本整形,rAF 回调内做 RenderTree 变更。即:每帧渲染更新都在跑,且不便宜。
3. **结构性放大**:每个事件(泵 8-50ms 聚合)进 webview 后要走完整链 —— IPC 反序列化 → appendOutput 全守望链(stripAnsi/正则×3/缓冲)→ **headless 镜像 xterm 全速解析**(即使真幕布已挂载,feed 互斥只做了一半:采样互斥、喂流不互斥)→ TerminalView xterm 再解析一遍。无人观看的会话与有人观看的会话吃同样的快拍。
4. **检测盲区**:既有守望全盯「渲染死亡」(rAF 探针 + 壳侧心跳 → focus/reload 阶梯)。「渲染活着、字节链断了」(订阅丢失/回放 Promise 悬死/xterm 写队列卡死)零覆盖 —— rAF 照跳,阶梯永不击打,幕布停旧帧直到人手点刷新钮。

目标:把主线程从「每个字节×每会话×每消费者」的照单全收里摘出来(治本),并补上数据链停滞的检出线(治漏)。

## 方案(已实施)

四件,全部「字节内容零丢弃,只动节拍/消费者数/检出线」:

1. **泵侧后台慢拍**(`pty_spawn.rs` OUT_BACKGROUND_WINDOW=250ms + `effective_window`):会话无激活幕布(`PtyHandle.viewed`,新 `session_set_viewed` 命令,TerminalView 激活态打点,readopt 复位)**或**前端渲染暂停(新全局 `RENDER_ACTIVE`,rafFallback 随 render_health 上报携带:`!document.hidden && rAF 间隙 < 2s`)时,聚合窗钳到 250ms。事件率 20+/s → 4/s(30 倍降),与前端隐藏幕布合帧/镜像采样同拍:Ask 徽标/呼吸灯时延不变;激活幕布保持原自适应窗,可见面延迟零改动。渲染暂停期(隐藏/遮挡吊销态)全会话降慢拍 —— 吊销触发期的负载底噪直接消失。
2. **镜像 feed 互斥补全**(`askScreenMirror.ts`):已挂幕布的会话不再喂 headless 镜像(采样互斥早已有,喂流互斥是本轮补的)—— 挂载期同流双份 xterm 解析减半。幕布卸载时以幕布终态同步 `reseed`(几何用幕布实栅格,先于注销 handle,时序无交错),后台 Ask 采样无缝接管;CLI 闸从 appendOutput 内联挪进镜像 ctor 谓词(feed/reseed 共用)。
3. **幕布数据链停滞探针**(`canvasStall.ts` 纯函数 + `terminalCanvasHealth.startCanvasStallProbe`):2s 巡检,「PTY 3s 内仍在产出(lastActivityAt)而本幕布订阅 6s 未收任何字节(ptyLiveTopic 入口戳)」= 数据链断供 → 自动 canvasGen 自增(重订阅 + 缓冲回放)。判据刻意保守:仅激活+流就绪、rAF 间隙 ≥4s 退出(页级冻结归守望阶梯)、PTY 静默不判、30s 重建冷却。
4. **配套收纳**:askProbe/stallProbe/reseed 屏幕构建拆 `terminalCanvasHealth.ts`(TerminalView 回到 299 行铁则内)。

## 方案取舍

- **选定:泵侧(Rust)降档** vs 前端(JS)降档:前端降档不省 IPC 反序列化与事件派发(主线程开销大头),且吊销态下 JS 自身就在挨饿 —— 传感器与执行器都必须在字节过河之前。
- **选定:viewed=会话级 + render_active=全局 双旗** vs 单一全局旗:全局旗无法区分「用户正盯着的会话」(必须 8ms 保打字回显延迟)与「无人观看的会话」(250ms 足够);双旗取交集,冷启动缺省双双保守(慢拍),首拍心跳(≤5s)即对齐。
- **选定:render_active 搭 render_health 便车** vs 新独立命令:边沿 ≤5s 收敛已够(吊销窗口是分钟级),省一条 invoke 链与守望测试的重写;occlusion→降档最长延迟 10s(stuck 上报节拍),可接受。
- **选定:reseed 同步直写** vs 沿用 backfill 异步路径:backfill 等 querySize 的窗口内活字节可能先到(顺序反转丢 Ask 态);幕布卸载时几何已知,同步重建无竞态。
- **被否决:SSH io 通道同步降档**:russh select 循环重构风险大,且无现场证据指向 SSH 洪水;留观(标记对 SSH 会话幂等无害)。
- **被否决:激活幕布洪水期合帧**:激活面是「字节保真铁律的可见面」,现有自适应窗(8→50ms)已是既有取舍,不再动。
- **被否决:停滞探针联动 UI 提示**:自动重建静默完成即最优解;提示是噪音,刷新钮仍是手动后手。

## 验证

- 单测:canvasStall.test.ts 6 例(实锤/边界/非激活/渲染冻结退出/冷却/PTY 静默);askScreenMirror.test.ts 互斥用例重写(feed 不吃流 + reseed 补种 + 注销后直喂);askScreenMirror.host.test.ts 同步(host.reseedScreenMirror 接线);sessionAdopt.readopt.test.ts 补 viewed 复位断言;pty_spawn_tests.rs effective_window 2 断言(前台透传/后台钳 250ms);pluginPermissions 补登记。
- 门禁:pnpm typecheck / test(3588 全绿)/ check:arch-boundary / check:file-size / build;cargo test(339)/ clippy -D warnings / fmt 全过;react-doctor 100(收口铁则)。
- 现场取证方法沉淀:打包实例 WebContent `sample <pid> 5` 看 updateRendering/layout 占比 + 会话日志 mtime/size 算洪水速率,是后续复发的分诊入口。
- 真机长时观察留用户:重点盯「多会话并发工作期整夜挂机」与「窗口遮挡后回前台」两个历史高发场景。

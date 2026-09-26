# 会话异常退出通知与一键续聊(失败分类第一片)

> 日期:2026-09-26 · 状态:已落地(真机目检待大仙)
> 上游:能力盘点 `docs/research/client-capability-gap-analysis.md`(P1-6)

## 目标

「CLI 崩了界面上静默消失,想续聊还得去历史里翻」。本变更:① PTY 退出码打通(portable-pty → pty://exit 载荷);② 内核新增 `sessionExitedDetail` 详情事件(元数据快照 + exitCode);③ 异常退出(非 0/非 130)弹右下角 toast,一键续聊(openDiskSession 原样 resume)。

## 范围边界

| 面 | 做 | 不做(去向) |
|---|---|---|
| 分类 | exitCode 三态:0 正常不扰 / 130 用户 kill 不扰 / 其余(含 null 竞态)= 异常上卡 | 更细分类(额度/信号名)——portable-pty 归一 u32,信号语义平台不一,先按异常面呈现 |
| 载荷 | 新 topic `sessionExitedDetail` 与旧 `sessionExited` 同边沿补发 | 改旧事件载荷形状——六个消费方(archive/兜底封口/ssh/锚点/notify/沉淀)零迁移 |
| UI | app-shell `ExitSessionToast`(复用 sft 卡样式与 12s 栈纪律),续聊钮仅在 kind≠shell 且有 cliSessionId 时渲染 | 常驻「已退出」会话行(动 workspace 列表面,先验 toast 价值) |

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 退出码来源 | portable-pty `ExitStatus::exit_code()`(kill 后 wait 收尸既有语义不变) | 信号级细分(平台差异大,宁粗不错) |
| 事件形态 | 补发新 topic | 改 sessionExited 载荷 = 六消费方连坐迁移,回归面无谓放大 |
| 挂载 | app-shell(内核生命周期 UX,StartFailureToast 同款先例) | 塞进 notify 插件——notify 是通知通道插件,退出续聊是会话生命周期 UI |
| 续聊入口 | toast 内 `openDiskSession`(锚定/去重/预热接管全套语义复用) | 裸 createSession+回放——绕过磁盘会话绑定守护 |

## 风险

| 风险 | 对策 |
|---|---|
| reload 竞态丢句柄(code=null) | 呈现 code "?",按异常处理(宁扰一次不漏崩溃) |
| SSH 会话退出 | ssh 走同一 pty://exit 同构通道,详情事件自然覆盖;续聊钮按 cliSessionId 有无决定 |
| toast 打扰 | 0/130 已过滤;12s TTL;最多叠 3 条(StartFailureToast 同纪律) |

## 验证

- 门禁:cargo clippy/fmt/test + 前端五闸 + react-doctor 100。
- 单测:`ExitSessionToast.test.tsx`(标题/退出码/续聊钮条件/null 渲染)。
- 真机:杀一个 omp 进程(tab 里 Ctrl+C 退不出时 kill CLI)→ toast 出现 → 点续聊恢复,由大仙目检。

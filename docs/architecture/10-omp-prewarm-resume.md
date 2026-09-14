# 10 omp 打开历史会话:预热进程接管

日期:2026-09-13(调研 docs/research/omp-session-open-performance.md,同日落地)

## 结论

omp 打开磁盘历史会话从「冷 spawn 一个 `omp --resume <id>`(实测 3.6-4.0s,其中 loadExtensions 扩展加载独占 ~2.7s)」升级为:**后台预热一个裸 omp 进程待命(扩展加载完成为就绪),打开历史会话时经 `profile.acquireResume` 钩子接管 —— 注入 `/resume <id>` 触发 TUI 内 `switchSession` 热切换(实测小会话 0.24s / 大会话 1.2s);接管目标一确定即经 `signals.onAcquired` 早激活,kernel 立即装配激活(workspace 补写 / 身份绑定 / 常驻订阅 / 置 active),幕布即刻挂载,渲染走磁盘先行回放 + 常驻订阅直播,切换不再压在整段 resume 渲染之后(f9c269e)**。接管目标确定前的任何环节失配(池空 / cwd 不合 / 未就绪 / 注入失败 / 特征超时)降级默认冷路径,不劣于现状;**onAcquired 已落地后的钩子失败(特征超时熔断 / 等待期死亡)不回退冷路径** —— 身份已绑,再 spawn 同一磁盘身份会出双 PTY(adopt 落败竞态守卫归零,自愈冷路径);特征超时熔断本运行周期且不再杀进程(失败的 resume 字面可见,关 tab 即清)。仅 omp 一家:其余引擎要么本就亚秒(claude/codex),要么 `/resume` 带参弹选择器(kimi/grok),要么注入文本会被当 prompt 发给模型(opencode,禁用)。

## 契约

- **kernel 通用原语(零引擎语义,契约在 `kernel/cliProfile.ts`)**:`CliProfile.acquireResume?(cwd, cliSessionId, signals: { onAcquired(sessionId) }) → Promise<{ sessionId, replayTail } | null>`;`sessionSpawn.open` 在去重闸内先问钩子:钩子目标一确定即回调 `onAcquired`,kernel 立即 `adoptResumeTarget` 早激活(①`session_set_workspace` 补写工作区归属 —— 预热 spawn 时未知,失败不阻断 ②身份绑定 ③常驻订阅 ④置 active),不等钩子全程 —— 激活是打开路径唯一的状态切换,压在钩子全程之后就是大会话点击 1-2s 死寂的根因;钩子 resolve 后 `replayTail` 预灌输出缓冲(**只进存储,不进守望主链** —— 与磁盘回放红线同律,防 askWatch/activityWatch 误开轮/误未读、screenMirror 整段 write 堵解析;Ask 恢复由挂载回放的 `observeReplayTail` 真实 marks 承担),走早激活路径时回空串即可(渲染经常驻订阅直入幕布,预灌只会重复);onAcquired 未落地时钩子 null/抛错降级冷路径,已落地后不回退(见结论)。冷路径 spec 组装后置到未命中分支(transform 对接管分支是白算)。
- **影子会话隔离(sessionShadowing.ts)**:插件后台 PTY 以影子身份隔离出会话表,合流点统一滤除 = `host.setSessions` / `refreshSessions` / `readoptSessions` / `bootAskRestore` 四处;接管转正前解除登记;集合同步写 sessionStorage,webview 重载后 `restoreShadowSessions()` 幂等恢复(boot readopt / 插件 activate / bootAskRestore 先到先得),插件 activate 清杀重载遗留进程。插件侧 spawn 一 resolve 即 mark(缩小未隔离窗口)。
- **omp 插件私有语义(prewarm.ts / prewarmFs.ts)**:预热目标 = 全局最近一次 omp 会话活动目录(桶内最新 jsonl 头部自证 cwd,不依赖桶名编码;近 7 天无活动不预热);就绪判定 = spawn 后 6s(覆盖扩展后台加载 ~4.5s);待命 10 分钟未消费自动回收(单预热进程 RSS 实测 ~700-810MB);消费成功 1s 后补货(REFILL_DELAY_MS 3s→1s,与死区内冷启动 loadExtensions 错峰);生命周期代数(epoch)保证 stop 后在途 spawn 链不落位;移交前先解影子登记(否则 kernel `setSessions` 过滤掉接管目标)。注入序列 = 整行(不含回车)→ 150ms → 单发 `\r`(规避 pi-tui 粘贴爆发启发式);成功特征 = 屏幕文本 `Resumed session`(事件驱动,输出/退出回调命中即 resolve,5s 超时兜底);**注入写失败 ≠ 特征失配,不熔断**(传输错可重试,特征超时才熔断本运行周期且不杀进程 —— 失败的 resume 字面可见,关 tab 即清)。
- **出生空会话文件窄删**:spawn 后 2s/5s 两轮锁定窗,桶 diff **恰好一个新增且头部无 `"role":"user"`** 才删(锁定为我们自己的出生文件);多新增(用户同时手开 omp)全不碰 —— 宁残留一个空会话文件(列表噪音)不宽删真实会话。reap/转正期无安全判据,不再清理。
- **cwd 硬约束**:omp 热切换的 cwd policy 拒绝跨桶切换(File not found)→ 池按 cwd 精确匹配,失配回落冷路径(冷路径自身支持跨项目切换)。
- **磁盘身份零扰动**:热切换不建新文件、不写目标文件(实测),`bindIdentity`/`.logptr` 语义与冷路径一致;`prefetchDiskTail` 预取槽在接管路径不消费,随下次预取自然淘汰(单槽语义)。
- **已知边界(接受)**:①接管字节缝隙 —— acquire 侧退订到 `adoptPtySession` 订阅建立之间(毫秒级)尾部帧丢弃,与冷路径 spawn 缝隙同级;②webview 重载时出生文件已无快照可锁定,可能残留一个空会话文件;③注入命令 `/resume <id>` 的输入框回显留在回放滚动里;④插件被禁用跨 reload 时,恢复的预热进程无人清杀(readopt 只滤不杀),活到 app 退出。

## 关键文件

- `src/kernel/sessionShadowing.ts` —— 影子会话登记/过滤/跨重载恢复
- `src/kernel/sessionSpawn.ts` —— open 的 acquireResume 分支(replayTail 预灌 + adoptSpawned 复用)
- `src/kernel/cliProfile.ts` —— `CliProfile.acquireResume`(含 `signals.onAcquired`)钩子契约
- `src/kernel/sessionStartFail.ts` —— 秒退守望/报错摘要(自 sessionSpawn 拆出)
- `src/plugins/cli-omp/prewarm.ts` —— 池状态机/注入/特征/熔断/回收
- `src/plugins/cli-omp/prewarmFs.ts` —— 预热 cwd 发现 + 出生空会话清理

## 验证

- 单测:`sessionShadowing.test.ts`(过滤/幂等恢复)、`sessionSpawn.acquire.test.ts`(命中接管 seed 预灌 / workspace 补写及失败降级 / onAcquired 早激活单次装配 / 早激活后 null 不回退 / null / 抛错 / 未声明降级 / 空 replayTail)、`cli-omp/prewarm.test.ts` 15 例(注入序列/特征转正/check-out 原子/特征超时熔断/注入写失败不熔断/exit 清场/出生文件锁定窗三态/mark 提前/无活动不预热/待命回收);Rust `session_tests.rs`(set_workspace 更新与拒绝);全量前端 + Rust 测试绿。
- 真机:tmd-cli 运行 ~14s 后侧栏外应有 omp 待命进程(ps 可见 `bun .../omp`,RSS ~700-810MB);打开 omp 历史会话应亚秒出完整画面且立即可交互,工作区面板该会话行在列(非缺行)、tab 可置顶;连续打开第二个(>3s 间隔)同样命中;omp 会话列表不出现 Untitled 空会话。

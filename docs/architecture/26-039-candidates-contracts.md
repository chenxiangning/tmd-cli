# 26 · 0.3.9 七候选落地契约(worktree 链 / diff 批注 / 窗口推算 / agent wiki / 懒加载)

日期:2026-10-18 · 状态:已落地(0.3.9 七候选全量;依据 `docs/design/040-candidates/feasibility.md`)

## 会话↔worktree 映射(workspace 持有)

- 存储:localStorage `tmd.wtSessions.v1` = `{ [tmdSessionId]: { branch, wtPath, root } }`;写者 = workspace 的 WorktreeSessionDialog(会话卡右键「在新 worktree 中起会话」),读者 = workspace 三处行徽标(WorktreeBadge)+ git 管理面会话数徽标。
- git ⇄ workspace 双向插件依赖为仓库首例,双侧消费纯模块(无生命周期、不经 ctx),import 处带豁免注释;若第三域再来消费,应把 store 上提到中立位置。
- 幽灵清理:WorktreeManageDialog 打开时按 `host.getSessions()` 存活 id 集 `pruneWtSessions` 一次。
- 创建链铁律:spawn 必须走 `host.spawnRawSession`(kernel 统一装配:identityTrack/事件广播/侧栏可见);直调 `ipc.sessionSpawn` 绕过装配 = 侧栏不可见+审批/时间线全盲。symlink 失败不阻断;后续失败 best-effort 回滚残留树并在错误文案指明手工入口;busy 期间禁关窗。

## diff 批注(git 插件私有)

- 存储:localStorage `tmd.diffNotes.v2`,组键 = 批注时刻激活会话 id(无激活回落 `ws:<root>`),LRU 40 组;行锚 = 文件路径 + djb2(行内容 trim)哈希,防行号漂移。
- 同文重复行:ownerRow 归属表按「|行号−批注行号| 最近者胜」选唯一锚行,气泡/揭示/闪示只在锚行。
- 回传:拼结构化文本经 `@kernel/composerExt` composerInsertRef 填入输入框(不自动发送);composer 未挂载须先闸(toast),否则 sent 置位后批注不可达。双窗口并发写靠 `storage` 事件失效缓存。

## claude 限额窗口推算(welcome 私有)

- `welcome/quotaWindow.ts`:仅 claude(codex/omp/pi 有真额度体系 `cli-shared/quota/`+凭据区,不双轨);usage 行按会话尾读 128KB 精化(追加式 JSONL 的近期行在尾部);`resetAt <= now` 视为无数据显「—」,不显冻结值。

## agent wiki(memory-coordinator 子模块)

- 存储:工作区 `<root>/.tmd/wiki.json`(工作区内点目录,与全局 `~/.tmd-cli` 分层;tmd-cli 自有写进用户工作区的首例,用户可自行 gitignore)。条目 `kind: auto|decision|open`,auto 由退出钩子写入(同 sessionId 幂等),人工改类。
- 钩子时序铁律:`kernel.sessions.exited` 发射刻会话与 CLI 身份仍在账本,同步取齐 `{cwd, harness, cliSessionId, readMsgs}` 后才能进异步;排队任务内重查 sessionId 会撞 hostWatches 清账本 → 条目静默丢失。
- 读写互斥:钩子与面板写盘共过 `withWikiLock`(模块级队列,锁内先读后写);面板刷新走 `host.events` topic `memory-coordinator.wiki.updated`(不用 window CustomEvent,事件总线是跨插件通信唯一通道)。

## 插件懒加载(kernel lazySuspense 原语)

- `kernel/lazyTab.tsx` `lazySuspense<P extends object>(load)`:注册面把重组件改 `component: lazySuspense(() => import("./X").then((m) => ({ default: m.X })))`,meta/图标/侧栏动作保持静态。渲染面零改动(Suspense 内嵌)。
- 已懒:workbench 双 tab / anim / git 面板+三 diff tab / memory 控制台+wiki。**必须保持静态**:kernel、cli-shared(共享单例)、terminal(xterm 常驻首屏)、composer(交互核心)。
- 红线:被懒组件仅可被注册面消费;若新增静态 import 指向同一模块,Vite 会把它并回主包,懒加载静默失效(build 后核对 DesktopApp chunk)。

## kernel 分区盘点

- `scripts/check-kernel-audit.mjs`:清单(`--json`)/摘要;标签 `scripts/kernel-audit.json`(键=kernel 相对路径,tag ∈ host/contract/move/pending,标签校验无条件执行)。`--check`(CI):tag=move 且仍有 kernel 内引用 → 红;**move 是迁移完成声明,须与消除引用同一提交,未迁完保持 pending**。
- 引用扫描覆盖:`from`/动态 `import()`/副作用 `import "x"`/`vi.mock("@kernel/x")`;路径解析归一 cwd 相对(绝对路径静默失配是首版坑)。

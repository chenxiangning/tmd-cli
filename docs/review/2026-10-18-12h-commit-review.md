# 2026-10-18 · 12 小时窗提交 review(12 commits,bee5c9c3~1..67ca88c7)

**日期**:2026-10-18
**状态**:review 完成,发现全修,收口提交 `fix(review)`(见文末)
**范围**:2026-10-18 01:33–11:37 的 12 个提交,78 文件 +6435/-144;七个候选域 = 040-candidates 文档、kernel-audit 入 CI、welcome 限额窗口、agent wiki、diff 行级批注、worktree 会话链、lazySuspense 懒加载。

## 一、批次内容速览

| 提交 | 主题 | review 切片 |
|---|---|---|
| bee5c9c3 | 040-candidates 调研与视觉示例(纯文档) | 文档登记核对 |
| 8bdd672f | kernel-audit 入 CI + WebGL 基准页 | kernel |
| 5e4c89da | claude 限额窗口本地推算 | wiki/quota |
| a58cef25 | agent wiki 子模块 | wiki/quota |
| 68243e8e | diff 行级批注 | git 批注 |
| b865c78b | worktree 会话链主体 | worktree / Rust |
| 5b001b2d | lazySuspense 原语与五重组件懒加载 | kernel |
| 5b089723 / d499892c | 徽标样式补交 / pin 铁律 + retryImport 护栏 | worktree / kernel |
| ab75bb76 | 七候选入口契约测试 | git 批注 |
| bc0edfbc | worktree 入口重梳(工作区右键恒显) | worktree |
| 67ca88c7 | 新工作区心智 + 批注面板修 + wiki 收敛 | 全部 |

## 二、Findings 与处置(五路并行 review 汇总)

### major(5,全部已修)

1. **「检出已有分支」选项集必败**(worktree)——选项取自 `gitWorktreeList` 的已挂分支,而 git 拒绝检出被任一 worktree 占用的分支;可检出的未挂分支反而不在列表,下拉每一项都必失败。修:选项集改 `ipc.gitBranches` local 全集剔除占用分支,空集给提示;WorktreeSessionDialog + 新增可选出集。
2. **来源工作区绕过 workspaceOrigins 契约**(worktree)——WSL 来源工作区走 worktree 弹层会用本地 git 写远端 fs、本地引擎 spawn 到 UNC cwd,绕开 `filterCliProfiles`/`spawnCliSession` 接管。修:SessionMenu 的 worktree 项仅本地工作区(`!origin`)渲染。
3. **toggleSent 名为 toggle 实为单向置位**(git 批注)——面板「撤销已回传」按钮调它永远是 no-op,已回传批注无法重发。修:`note.sent = !note.sent`,测试改钉来回切换。
4. **wiki「双窗广播」跨窗无效**(wiki)——`host.events` 是进程内总线,另一窗收不到;并发写互相盲写覆盖。修:写盘后 bump `tmd.wiki.beat.v1` localStorage beat,对端 WikiPanel 经 storage 事件重读(diffNotes 先例);钩子与面板双端接入。
5. **wiki 读失败当空文档覆写**(wiki)——非 ENOENT 读错误(fd 压力/IO 抖动)会让钩子把 500 条清成 1 条、面板以空基线落盘。修:`isMissingReadErr` 区分缺失(os error 2/3)与真错误;真错误 = 钩子放弃本条并 warn、面板 toast 且不写盘、初始读失败停在未读态。

### minor(9,全部已修)

6. **Windows junction 降级双层引号打碎参数**(Rust)——`format!("\"…\"")` 预包引号被 std 逐参转义二次包裹,cmd 剥不出真路径,非特权态(默认态)node_modules 复用全量静默失效。修:`raw_arg` 整段命令行一次成形(`/d /s /c` + 显式引包),引号内 cmd 元字符安全;macOS 不可实跑,已按 std/cmd 文档化行为推导,建议 Windows 实机复验一发。
7. **符号链接原语双实现分叉**(Rust)——`fs::symlink_dir` 与 `skill_pkg::create_skill_symlink` 近同构且 Windows 失败语义相反。修:skill_pkg 委托 `fs::symlink_dir` 单一原语(父目录创建并入),junction 修复自动惠及两处。
8. **同文多行归属只按最小批注行号裁决**(git 批注)——同 key 多条批注时全部气泡错挂到离最小行号最近的行。修:`notesForRow` 逐条裁决(每条归 |ΔlineNo| 最小的可见行,一行可承载多条),揭示闪示同步只命中持有行。
9. **揭示桥无身份守卫 + noteCtx 每渲染新建**(git 批注)——多实例后卸载会清掉他人 handler;effect 每渲染拆装。修:cleanup 身份守卫(Composer 先例)+ noteCtx/useMemo。
10. **sessionKey 渲染期直读 host 不订阅**(git 批注)——会话切换后批注落错分组、面板徽标陈旧。修:订阅 `activeSessionChanged` 存 state。
11. **管理面徽标计数未归一路径**(worktree)——`countSessionsForWtPath` 裸字符串比较,Windows 混合分隔符下恒 0(2026-09-27 同类 bug 二犯)。修:两侧走 `normalizeRoot`。
12. **菜单扎点仍把短码写进快照**(worktree)——RunningZone/PinnedSessions 的 `onPinScope` 传 `titleOf()`(短码兜底),违背 sessionPins 铁律。修:改传真标题等价物(`realTitleOf`/`realPinSnapshot` 链)。
13. **wiki.test 摘录用例名实不符 + 剪枝零覆盖**(wiki)——60 条 fixture 拼接不足 800 字,「保尾截断」分支从未触达;ENTRIES_MAX 剪枝无用例。修:补单条超 800 真截断用例 + 502 条剪枝用例(最旧 auto 被剪、decision 保留)+ isMissingReadErr 用例。
14. **CHANGELOG「拍板流转可撤回」与实现不符**(wiki)——实现只有改类/删除。修:文案对齐实现,并补跨窗 beat 说明。

### nit(9,全部已修)

15. 引擎候选为空时可创建空 command spawn → `canCreate` 加 `pickedProfile !== ""`;dirErr 静默禁钮 → 表单内联显示。
16. 回滚不对称残余:spawn 成功后 `recordWtSession` 抛错会回滚删掉活会话脚下的树 → 创建编排按里程碑(`added`/`spawnedId`)分四种结果,编排抽到 `worktreeCreate.ts`(顺带降组件复杂度过 react-doctor)。
17. 徽标读放大:`loadWtSessions` 每次 JSON.parse → version 键 memo。
18. 陈旧头注释 ×2(会话卡右键 → 工作区右键菜单)、双发 `sessionViewRequested` + 错乱缩进(SessionMenu,25f0fd17 遗留,消费方幂等无功能危害)。
19. `lazyTab`/`lazyImport` 注释:终败约 87.5s 后仅整页 reload 可恢复的已知限制、退避总时长三处口径统一;kernel-audit.json 懒加载消费计数改为四插件 9 处(anim 1/git 4/memory-coordinator 2/workbench 2)。
20. wiki EntryRow harness 徽标未走 `harnessLabel`;manual 条目 sessionId 塞全文 → 置 `"manual"`;面板草稿不随切区清空 → 切区清稿;尾读精化偏差方向补注释(start 偏晚 → 倒计时偏长的保守侧)。
21. diffNotes 内存态注释失实(写后即归零)→ 改如实描述。
22. 揭示定位静默失效(跨文件/折叠段/split)→ 跨文件点击改为先切文件(再点即揭示);折叠/split 场景维持现状(行级批注在双栏模式本就禁用,面板空态有提示)。
23. 相邻遗留:BranchNameDialog/BranchRow 的 Enter 提交无 IME 守卫(同批 NoteInline 已守)→ 补齐。

### 已核对无问题(覆盖面摘要)

- worktree 回滚对称(addWorkspace→removeWorkspace)、bumpBranch 递增纯函数、node_modules 链接双层 catch 不阻断、弹层脱离菜单生命周期(wtWs 独立 state)。
- diffNotes 内容哈希锚定(djb2+trim/换行残影)、patch 拉取 token 防竞态、composer 回传走 `@kernel/composerExt` 内核契约、store 换代冻结修复(cache 置空强制重解析)无残留同类。
- lazyTab 懒加载结构性成立:九个重组件零静态导入、kind 常量轻模块、EditorCenter 只挂激活 tab、keepAlive 不重挂;retryImport 护栏行为有测试钉。
- check-kernel-audit 语义(缺文件/非法 tag/幽灵键 exit 1)、CI 链与 check:gate 同序;bench.html 独立工具页零构建链副作用。
- wiki 退出钩子时序(exited 发射刻同步取齐身份)、withWikiLock 串行化、幂等与解析兜底有测试钉;quotaWindow 七用例与实现逐条吻合(严格大于/resetAt/过期 clamp/家族闸)。
- Rust 面:dir_size 跳 .git 不跟符号链接(spawn_blocking+单测)、新命令双登记 pluginPermissions、无插件私有知识下沉、web 桥无暴露臂。
- i18n:本批新增/改动键 en/ja 成对(check:i18n-keys 绿);文档全部登记 docs/README.md;CHANGELOG 0.3.9 小节在位。

## 三、验证记录

- `pnpm check:gate` 全绿(file-size/arch-boundary/i18n-keys/kernel-audit/typecheck/test 519 files/build)。
- `cargo test`(356 passed)+ `cargo clippy --all-targets -D warnings` + `cargo fmt --check` 全绿。
- `npx react-doctor@latest` = 100/100。
- 浏览器桩目检(1421,诚实桩):工作区右键菜单本地工作区恒显 worktree 入口;弹层分支预填/目录推导(盘根工作区如实显「…」)/检出分支选项集 = gitBranches 全集;来源工作区隐藏项经 `!origin` 代码路径 + entryContract 渲染钉覆盖(1421 dev server 中途被宿主关闭,占用分支过滤一条以代码证据收口:单行纯过滤,输入两侧已实测)。
- Windows junction 修复无法在本机实跑(cfg(windows)),推导链见 Finding 6;发版前建议 Windows 实机复验。

## 四、遗留(不阻断)

- diffNotes「内存态」写入即失:仅测试/嵌入场景可达(生产 webview 有 localStorage),已如实注释。
- lazySuspense 终败仅整页 reload 可恢复:失败文案已如实,代数重建 lazy 方案(~5 行)留待有真实触发面时再做。
- kernel-audit 引用边扫描为原始文本(注释内 `@kernel/...` 字样理论误报面):今日无 move 标签,空转;出现首个 move 标签时再考虑剥注释。
- aggregateUsage `windows` 字段与尾读精化覆写无直测(需 fs 桩,现有窗口纯函数已钉);token 聚合侧后续补。

## 五、收口

本文件所列 23 项 findings 全部修复并随 `fix(review)` 提交;验证链见「三」。登记于 `docs/README.md` 文档索引。

## 六、二轮打磨:主线链路追踪(同日,四路并行,13 项全修)

一轮收口后对四条主线链路做端到端追踪(worktree 生命周期 / diff 批注 / wiki 沉淀 / quota+lazy),只收真实执行路径问题:

### major ×3
1. **worktree 移除无活会话闸**(FlowWorktree):omp/pi 类会话文件落全局目录,树净即可删 → 活会话 cwd 被删成幽灵(进程仍写盘全败)。修:`removeWorktreeWithCleanup` 开头按 `countSessionsForWtPath` 拒绝,一处闸收两处 UI。
2. **wiki resume 重复沉淀**(FlowWiki):幂等键原为 tmd sessionId,续聊换 tmd id 后同 CLI 会话每轮退出 +1 条重复,并加速挤出真老条目。修:幂等键与落盘 `sessionId` 改 CLI 磁盘身份。
3. **quota 采集无界并发**(FlowQuotaLazy):逐会话 `fsReadHead`+`fsReadTail` 一次性全发,重用户 100+ 会话撞 fd 上限与中继 32 并发帽——正是 wiki 读失败守卫防的抖动源。修:头读走现成 `readHeadsBatched`(768KB 预算分块串行),尾读 4 并发闸。

### minor ×6
4. 移除 worktree 创建链缺 `sessionViewRequested`,最大化编辑器盖住新会话;新工作区卡缺省折叠看不到会话行 → 编排补 emit + 展开(FlowWorktree)。
5. 冲突/递增判定集漏未挂本地分支(树已删分支未删的残留,`git -b` 必拒一跳)→ 判定集改树占用 ∪ 本地分支全集(FlowWorktree)。
6. 揭示锚失配三态全程静默(纯删除行跨 diff/折叠隐去/切文件装载窗)→ 揭示桥返回命中布尔,miss 走面板 toast(FlowAnnotate)。
7. ws: 回退组批注在会话启动后「凭空隐没」且空态文案矛盾 → 空态补工作区暂存计数提示(FlowAnnotate)。
8. WikiPanel 非缺失读错误后永停「加载中…」假加载态 → 失败态 + 重试钮(reload 提升为 useCallback)(FlowWiki)。
9. 未来时间戳行(多设备时钟超前)把窗口倒计时拉飞 skew+5h → 推窗前整体剔除未来行,补 skew 用例(FlowQuotaLazy)。

### nit ×4
10. lazy 终败计入插件熔断计数,「重试该贡献位」每点 +1,3 次隔离整插件且毒化兄弟贡献位 → `LazyChunkError` + `LazyChunkBoundary` 迷你边界承接(不计数、指引 reload),非懒错误照常上抛主边界(FlowQuotaLazy)。
11. meta 行(`\ No newline at end of file`)出批注钮可产生行号 0 批注 → 悬停钮与归属裁决均排除 meta(FlowAnnotate)。
12. `ls()`「读即 LRU touch」为生产死代码语义(生产直读快照)→ 去触碰,注释与测试改钉「按添加序剪除」真语义(FlowAnnotate)。
13. wiki 读失败分支注释承诺的重试口实际不可达 → 修注释(FlowWiki)。

### 二轮专项裁决:wiki 存储位置不迁库
FlowWiki 提出迁移 `~/.tmd-cli/wiki/`(marks 零污染先例)消掉 `.tmd/` untracked 污染与 worktree 移除被拒。**裁定保留项目内 `.tmd/wiki.json`**(CHANGELOG/architecture/26 明示契约:随仓共享、人工可查),改用 `git_ensure_local_exclude` 新命令把 `.tmd/` 写进仓库本地排除(`.git/info/exclude`,幂等、零用户文件改动、worktree gitdir 局部生效)——同时消掉 git status 污染与 `git worktree remove` 因 untracked 被拒两个症状。钩子与面板两条写路径 best-effort 调用,非 git 仓静默。若大仙后续更倾向零项目足迹,迁移面仅 wikiHook/WikiPanel 两文件。

### 二轮验证
`pnpm check:gate` 全绿(520 files + build);`cargo test` 356 passed + clippy -D warnings + fmt 全绿;`react-doctor` 100/100。活会话闸/exclude 命令为集成路径,验证至编译链与单测层,真机目检随验收。

# Git 跨工作区批量操作设计(方向 A:Git 面板内聚合)

日期:2026-10-08 · 状态:已实施(门禁全绿 + 1421 桩目检全链路通过;真机目检留大仙)

## 背景与目标

大仙多仓工作流痛点:统一 pull/push 全部项目必须挨个切工作区,在 Git 面板逐仓操作。现状(2026-09-07 多仓落地后):Git 面板是「选中仓 cwd 语境」单视图,RepoBar 只做当前工作区内的仓切换,无跨仓批量能力(当时 spec 明确 v1 不做)。

目标:不出 Git 面板,对**全部工作区的全部仓**做统一 获取/拉取/推送,逐仓可见结果,失败可重试;点行直达该仓语境处理后续。

非目标:跨仓聚合 commit、跨仓 diff/changes 混排、manifest/手动注册编排(调研 §2.4 定为编排工具领域,不越界)、远程(WSL host)工作区的仓操作(git2 只认本机路径,排除并明示)。

## 方案取舍

| 方案 | 结果 | 理由 |
|---|---|---|
| A · 面板内聚合(RepoBar 加「本仓/全部」段控) | **选定** | 大仙 10-08 从三原型拍板;段控位置经截图指定在 RepoBar 行。复用现有面板与仓 chips,增量最小;聚合只是面板第二态,不动单仓肌肉记忆 |
| B · 中央「仓库总览」tab(gita ll 式表格) | 否决 | 离开会话语境,中央区被占;仓数 <30 时表格的筛选/勾选是过剩能力 |
| C · 侧栏汇总条就地批量 | 否决 | 失败详情无承载(toast 一行字说不清哪个仓为什么失败);侧栏行高预算紧张 |
| 批量执行并行化 | ~~否决~~ **2026-10-09 改并行** | 原否决「叠凭据弹窗、难归因」不成立:子进程本就 GIT_TERMINAL_PROMPT=0 禁交互(凭据类失败按行 E_AUTH 标注),行结果按 path 存 Map 与顺序无关。落地 = 前端有界并发池 BATCH_CONCURRENCY=6(aggregateModel.mapPool),Rust 零改动(远端操作 shell-out git CLI 每仓独立进程,repo 缓存锁「同 repo 串行、跨 repo 并行」不变量本就允许跨仓并行) |
| 聚合态挂轮询保活 | 否决 | 调研 §2.7:全仓高频轮询是反模式;进入聚合态/手动 ⟳/批量操作后各拉一次 |
| Rust 新命令 | 否决 | 全部复用现有原语:`git_repos_scan` / `git_status_batch` / `git_ahead_behind` / `git_pull_push`,Rust 零改动 |

## 设计

### 范围态(scope)

- GitPanel 组件内 `useState<"repo" | "all">`,会话期有效、不落盘;切工作区不重置(聚合恰为跨工作区而生)。
- 段控挂在 RepoBar 行尾:`本仓 | 全部`(10px segmented,同 ws-view-toggle 形制)。RepoBar 渲染条件从 `showRepoBar` 放宽为 `showRepoBar || 本机工作区数 ≥ 2`;段控可见门槛 = 本机工作区 ≥2 或当前工作区多仓——单仓单工作区用户零新 UI(回归红线不破),单工作区多仓(如 ER-QI 一区 19 仓)与多工作区用户(痛点人群)都进得来。
- 「全部」态:RepoBar 保留(chips 仍是当前工作区仓,点 chip = 选仓并退回「本仓」),面板主体换成聚合视图;GitToolbar/远端条/三视图/提交行整体不出现。
- guide(非仓根)与远程工作区在「全部」态不受影响:聚合视图扫描所有本机工作区,与当前 cwd 解耦(GitPanel 中 scope 分支置于 isRemote/guide 早退之前)。

### 聚合视图(AggregateReposView)

- 批量条:形制对齐本仓态 GitToolbar(左数字摘要 + 右 ⟳ 与动作簇,两端头部同位同构不跳频)。摘要 `N 仓 · x 可拉 · y 可推 · z 有改动` 窄宽省略截断;动作簇 = ⟳ + 分裂按钮组「拉取全部 ▾」(主钮 = 拉取全部;▾ 菜单复用 GitToolbar 的 MenuShell,含 获取全部/拉取全部/推送全部 三行带目标数,0 目标禁点);执行中变为进度 `{done}/{total}` + `取消`;有失败时给 `重试失败(n)`。
- 列表按工作区分组(组头:工作区名 + root 路径),行 = dirty 点 + 仓名 + kind 标 + 分支 + `↑a ↓b · n 改动`。
- 行三态:常态(hover 出行级 `拉取` `推送`,点行跳仓)→ 执行中(转圈 `拉取中…` / 灰 `排队…`)→ 结果(绿 `✓ 已是最新/合入 n 个提交`、灰 `⊘ 跳过原因`、红 `✗ 错误摘要`)。
- 跳仓:`setSelectedRepo(wsId, path)` + `setActiveWorkspace(wsId)` + 退回「本仓」态——落地即该仓完整语境,可处理冲突/提交后再推。
- 底部:排除了远程工作区时一行说明 `已排除 n 个远程工作区`。

### 批量执行语义(useBatchGitOps + aggregateModel 纯函数)

- 目标选择:fetch = 全部仓;pull = 有上游的仓(无上游行直接标 `⊘ 无上游分支`);push = 有上游且 ahead>0(其余标 `⊘ 无待推提交`)。
  **2026-10-09 修订(无上游仓推送识别)**:push 只看 ahead>0 —— 无上游的本地独有分支(Conductor worktree 常态,如 `chenxiangning/yokohama` → `origin/2-web-user-crud`)同样可推:降级统计的 ahead 即本地独有提交,目标缺省 `origin:<branch>`(弹窗行内可改,preview 按 `targetFound=false` 新分支首推口径),执行走结构化 `git_remote_request` 显式 refspec,不再回落 `git_pull_push`(其会报 no upstream);无上游仅拦 pull。「推送全部」菜单项不按可推数置灰(0 可推也开弹窗,行给原因、确认自会拦);行级 hover 快操推送按钮同口径(ahead>0 即显)。
- 有界并发 `BATCH_CONCURRENCY=6`(aggregateModel.mapPool)执行 `gitPullPush(path, op)` / `gitRemoteRequest`;取消 = 仓间断(在途仓跑完,未起仓标跳过)。
- 行结果文案(紧凑,区别于对话框长句):pull `已是最新` / `合入 n 个提交`;push `已是最新` / `已推 n 个提交`;fetch `已是最新` / `更新 n 个引用`;失败 = `gitErrorDisplay`,凭据类(isAuth)= `凭据需要交互,请在终端执行`。
- 完成后自动重拉聚合状态(行内 ↑↓ 数字校正),并调 `afterMutation` 让当前仓面板数据失效重取。

### 推送确认弹窗(BatchPushDialog)

- 菜单「推送全部」不直发,先开确认弹窗(对齐单仓 PushDialog 有确认闸;获取/拉取全部直发)。形态 = 单仓弹窗底栏 + JetBrains 多仓勾选列表:
  - 左列:全选行(`已选 n/m 仓`)+ 仓行(☐ + 仓名 + `↑n`;第二行完整 `branch → remote:target`,不截断);**target 行内可编辑**(点击进 input,Enter/失焦落定,Esc 还原;覆盖值高亮 accent,随推送下发并驱动右栏预览重拉)。可推(有上游且 ahead>0;2026-10-09 起无上游也推,见目标选择修订)默认全勾,不可推行禁选灰显并标注原因。
  - 右列:选中仓的本次推送内容(BatchPushPreview,复用单仓弹窗 `usePushPreview`/`useCommitDetails`)——上 = 提交清单(sha + 摘要 + 作者 + 相对时间,头部计数),下 = 选中提交的变更文件(状态字母着色 + 路径 + `+a/−d`,头部 `{n} 个文件`)。**提交清单按行内 `↑n` 截齐**(远端跟踪引用缺失时 Rust `push_preview` 回退全量历史,聚合口径只展示本次要推的)。
  - 层级:弹窗 `z-[1201]`(右栏层叠上下文压 z-1000 遮罩,先例 WorktreeManageDialog/network-proxy;DialogShell 加可选 `zClass` 参数,既有调用不变)。
  - 底栏对齐单仓:`推送标签` / `运行 Git 挂钩` 开关 + `取消` / `推送(n)`;确认后**留窗看进度**(2026-10-09 再修订):弹窗不即关,行尾换逐仓状态(转圈/✓/✗),底栏 `推送 {done}/{total}…` → 落定 `✓ 推送完成` / `✗ 推送完成,n 仓失败`;进行中「取消」= 假关闭(后台继续),聚合批量条给「查看进度」重开续看;执行期勾选/改目标/开关全冻结,确认计数冻结在确认时快照(防重扫 ahead=0 闪「推送(0)」)。**快照(pushed)归父层 AggregateReposView 持有**:重开不丢(重开弹窗续看逐仓状态与回执),仅菜单新开「推送全部」时清。配套:`DialogActions` 加 `cancelDisabled`/`cancelLabel`/`className`(顶距改调用方显式传 `mt-4`,内嵌 footer 行不传);单仓 PushDialog 同律留窗显 ✓/✗ 回执(开关弹窗即清,`locked` 解除允许假关闭),推送进行中工具栏推送行保持可点(重开看进度;`runDialog` 有 remoteBusy 闸防双推);拆件 `views/BatchPushStatus.tsx`(BatchRunStatus/RowPushBadge/BatchPushFooter/TargetEditor/BatchPushRow)。**2026-10-09 打磨**:左列行序可推置顶(禁选沉底,组内保持聚合序);✗ 徽标可点 + 内联截断失败原因,点开行内日志抽屉(完整 git stderr,mono 折行超高滚动);复选框 `accent-(--tmd-accent)` 着色 + 行级 err 徽标移出选择按钮(禁嵌套 button)。
- 执行通道:带选项推送走 `git_remote_request`(remote/branch 优先弹窗覆盖值,缺省拆自行内 upstream;`noVerify = !runHooks`、`followTags`);获取/拉取仍走 `git_pull_push` 快速原语。重试失败沿用上次弹窗选项。
- 否决项:批量 force-with-lease(无逐仓确认,危险面太大)、批量 Gerrit(每仓 topic/reviewer 语义不同,图 2 的 Gerrit 区不适用于异构多仓)。

### 取数(useAggregateRepos)

- 进「全部」态/手动/批量后:各本机工作区 `gitReposScan(root, 2)`(allSettled)→ 按 path 去重(嵌套工作区场景,首个工作区胜出)→ `gitStatusBatch(paths)` 一次拿 branch+dirty → 逐仓 `gitAheadBehind`(本地 revwalk,无网络)。
- 不挂任何轮询;组件卸载弃账(token 防旧响应覆盖)。

## 文件面

新增:`useAggregateRepos.ts`(数据)、`aggregateModel.ts`(纯函数:扁平去重/目标选择/行文案,配 `aggregateModel.test.ts`)、`useBatchGitOps.ts`(执行器)、`views/AggregateReposView.tsx`(视图)。
改动:`GitPanel.tsx`(scope 态 + 聚合分支 + 跳仓)、`GitPanelMain.tsx`(RepoBar 条件放宽 + 段控透传)、`views/RepoBar.tsx`(段控)、`locales/en|ja/git.ts`(新词条)。

## 验证

- `aggregateModel.test.ts`:目标选择(fetch 全/push 仅 ahead>0/pull 需上游)、跨工作区同 path 去重、行文案三 op 分支、mapPool 并发上限/完成补位/空清单。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
- 桩目检:聚合列表分组/批量三态/跳仓链路。
- reviewer 复核(2026-10-09)无 P0;已修:TargetEditor IME 守卫、空工作区早退复位 loading、execute 每次落 opts 堵陈旧分支覆盖、▾ 菜单坐标钳制、行级拉推仅显于有上游仓、执行中禁跳仓、`git_repos_scan` 截断标志透传组头「已截断」、全选框 indeterminate。
- 真机目检(ER-QI 19 仓实拉):留大仙。

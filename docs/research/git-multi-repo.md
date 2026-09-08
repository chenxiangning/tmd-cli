# Git 多仓支持调研:客户端现状与业界设计

日期:2026-09-07 · 状态:已完成 · 支撑 spec:[Git 多仓支持设计](../superpowers/specs/2026-09-07-git-multi-repo-design.md)

## 结论

1. 客户端当前是彻底的「单仓 cwd」设计:Rust 层 `Repository::discover` 只向上找仓;IPC 全部 `git_*(cwd, ...)`;消费侧(git 面板、文件树着色)只喂 workspace 根。多仓改造面集中在「repo 发现 + cwd 换源」两处,现有 git 能力(stage/commit/diff/log/branch/远端对话框)全部原样复用。
2. 业界多仓检测三类模型并存:GUI(VS Code / JetBrains)自动扫描 + 手动登记;Android repo / meta 用 manifest 文件;gita / mu-repo / myrepos 手动注册。桌面客户端应取「自动扫描 + 有界深度」,manifest 与手动注册是专业编排工具的领域,不越界。
3. changes 呈现两派:VS Code / JetBrains 在单列表里按 repo 分组;桌面客户端(Sublime Merge / Fork / Tower / GitKraken)与 TUI(lazygit / gitui)一律「单仓上下文 + 仓切换」。本客户端 git 面板是 cwd 语境的单视图,取上下文切换派:改动最小,且与既有提交流(单一提交按钮)一致。
4. 性能共识:发现用一次性扫描;刷新靠文件事件或低频巡检;聚合网络操作(fetch)低频或显式触发。全仓高频轮询是公认反模式。

## 一、客户端现状:单仓假设的代码事实

### 1.1 三层结构

| 层 | 位置 | 事实 |
|---|---|---|
| Rust 服务层 | `src-tauri/src/git/mod.rs` | `with_repo(cwd)` 用 `Repository::discover`(从 cwd **向上**找仓);进程级 Repo 缓存 FIFO 上限 16;「cwd 是唯一维度(Session = cwd + PTY),不引 workspaceId」是明文不变量 |
| IPC 契约层 | `src/kernel/ipc.ts` | 全部 git 命令收 `cwd` 参数(`git_status` / `git_stage` / `git_commit` / `git_log` / `git_branches` / `git_ahead_behind` / `git_remote_request` ...),注释明说「cwd 由调用方从活跃 workspace 取」 |
| 消费侧 | `src/plugins/git/GitPanel.tsx` | cwd = `useWorkspaces()` 活跃 workspace 的 `root`,一处来源;`useGitStatus` 5s 轮询,`useGitTotals` 低频纪律(60s 慢巡航 + 转可见 + 写后刷新),聚合数字经 panelStore 镜像到 GitToolbar |
| 消费侧 | `src/plugins/files/gitDecorate.tsx` | 5s 轮询 `ipc.gitStatus(root)`,按绝对路径建「路径 → 颜色类」map(含祖先目录聚合);修改=蓝、新增=深绿、删除/冲突=红、改名=琥珀(用户口径定值) |

### 1.2 workspace root 形态 × 现状行为矩阵

| workspace root 形态 | 现状行为 |
|---|---|
| root 自身是仓库 | 完整功能(基线场景) |
| root 在某仓库内部(子目录) | discover 向上找到外层仓;面板显示外层仓分支,但 root 之下大量文件不属于该仓,着色与 status 覆盖残缺 |
| root 非仓,内含 N 个嵌套仓 | 面板空态「当前目录不是 Git 仓库」;文件树零着色;嵌套仓完全不可管理 |
| root 自身是仓且内嵌其他仓 | 只见 root 仓文件;嵌套仓目录通常以单个 untracked 条目出现,不可展开不可操作 |

### 1.3 单仓假设的断点

- repo 发现能力为零:没有任何「列出 root 下所有仓」的原语(Rust 侧 `fs_walk` 是通用遍历,但不识别 `.git`)。
- 消费侧 cwd 换源成本极低:GitPanel 的 hooks 全部收 cwd,`cwd` 来源从 `active.root` 换成「选中仓路径」即全链路生效。
- checkpoints(`src-tauri/src/checkpoints/`)同样 `E_NOT_A_REPO` 依赖向上 discover;本设计不触碰其语义(见 spec 范围声明)。

## 二、业界调研

### 2.1 VS Code:自动发现 + Repositories 视图 + 分组选择

- 打开含多仓的目录即自动把所有 repo 列入 Source Control 的 Repositories 视图,每仓显示分支与同步状态,可单独 fetch/pull/push。
- `scm.repositories.selectionMode` 在「多仓模式(聚合全部 repo 的 changes,按 repo 分组、分组可折叠)」与「单仓模式(只看选中 repo)」间切换。
- commit 框旁有 repo picker;Status Bar 的 ↑x ↓y 只针对当前活动 repo——「聚合计数只给活跃仓」。
- 扫描控制:`git.autoRepositoryDetection`(含 scanWorkSpace 档)、`git.repositoryScanMaxDepth`(限制扫描深度)、`git.repositoryScanIgnoredFolders`;`git.autoFetch` 默认关(开启后 180s 间隔,per-repo 定时)。
- 机制本质:`scm.createSCMProvider` 每仓一个 provider 实例(各自 rootUri + resourceGroup),UI 按 rootUri 自动分组。
- 来源:[repos-remotes](https://code.visualstudio.com/docs/sourcecontrol/repos-remotes) · [overview](https://code.visualstudio.com/docs/sourcecontrol/overview)

### 2.2 JetBrains:Directory Mapping 是多仓模型之根

- 模型 =「project → 多个 VCS root」;clone 含 submodule 时子模块自动注册为 root;手动场景在 Settings | Version Control | Directory Mapping 显式登记,**未登记目录不被识别**。
- changelist 是 IDE 层(跨 root)概念,文件按路径归属 root;commit 工具窗单入口;push 对话框按 repository 分节显示各自未推送提交。
- 「synchronous repository control」默认关——多仓不同步控制时操作只作用于当前 root。
- 已知坑:root 未 mapping 时文件状态显示正常但不参与 commit/push(隐性失效);changelist 与 git index 双模型易困惑,故另提供 git staging area 开关。
- 来源:[set-up-a-git-repository](https://www.jetbrains.com/help/idea/set-up-a-git-repository.html) · [commit-and-push-changes](https://www.jetbrains.com/help/idea/commit-and-push-changes.html)

### 2.3 桌面客户端:单仓窗口 + 仓切换,不做跨仓聚合

- Sublime Merge:一窗口一 repository,多仓 = 多窗口;Fork 同;Tower 例外地有手动注册的 repo 侧栏(切换即换仓上下文);GitKraken 用仓库管理器(tab)切换。四者均无跨仓 changes 聚合。
- submodule 在桌面客户端一致处理:「点击进入,变成独立单仓视图」,不与父仓混排。
- 对本设计的含义:多仓聚合面板反而是 GUI 桌面客户端没做的差异化;「上下文切换」是桌面客户端的主流保守解。
- 来源:[Sublime Merge docs](https://www.sublimemerge.com/docs/);Tower/Fork/GitKraken 官方文档页 404(官网 docs 路径变更),其单仓窗口模型为业界公开常识,此段结论含 [INFERENCE] 性质。

### 2.4 CLI 编排工具:三种注册模型 + 聚合纪律

- manifest 型:Android repo 用版本化 XML manifest(remotes/projects/path/revision),`repo sync` 并行拉取并 pin revision;meta 用 `.meta` 文件(子仓路径→URL 映射),`meta exec "git status"` 对全部子仓执行。
- 手动注册型:gita 存 `repos.csv`,支持 `gita add -r <parent>` 递归扫描;mu-repo 用 `mu register` 写 `.mu-repo`。
- .mrconfig 型:myrepos 用 INI 风格配置,`mr -j5 run git status` 并行执行(官网拒连,细节为社区共识补充)。
- 聚合形态:一律「逐仓串行/并行执行 + 逐仓标注结果」,绝不合并成虚拟仓;gita `ll` 每仓一行(branch + 领先落后着色 + 状态符);「无参数 = 全部仓」是 gita 默认约定。
- 已知坑:交互型命令(log/difftool/mergetool)必须排除并行;聚合 commit 有跨仓「失败一半」问题(repo 用 per-project revision pin 缓解)。
- 来源:[repo manifest](https://gerrit.googlesource.com/git-repo/+/master/docs/manifest-format.md) · [gita](https://github.com/nosarthur/gita) · [meta](https://github.com/mateodelnorte/meta) · [mu-repo](https://github.com/fabioz/mu-repo)

### 2.5 TUI(lazygit / gitui):单仓模型,嵌套仓是导航不是聚合

- lazygit 固定 side panels 含 `worktrees` 与 `submodules` 两栏:enter 进入该 submodule/worktree,即「切换到另一个 repo 上下文」;不做跨仓状态聚合、不分组 changes。
- 结论:TUI 生态共识 = 不做聚合,把嵌套仓做成入口/导航。
- 来源:[lazygit Config](https://github.com/jesseduffield/lazygit/blob/master/docs/Config.md)

### 2.6 submodule 与普通嵌套仓:业界确实区别对待

- submodule 是 git 一等公民(.gitmodules + gitlink + 显式 update 语义):JetBrains 自动注册为 root、VS Code 默认识别、lazygit 给独立面板。
- 普通嵌套仓(vendored)无任何工具默认识别:需手动登记或显式递归扫描;扫描方案需读 `.gitmodules` 区分 submodule 与 vendored,或全部平视仅标注类型。
- 磁盘区分零成本:`.git` 为目录 = 普通仓/worktree,`.git` 为文件(gitdir 指针)= submodule 或 linked worktree,可再对照 `.gitmodules` 分类。

### 2.7 性能:业界做法

- VS Code:一次性扫描(`repositoryScanMaxDepth` 限深)+ FS watcher 驱动、只对 dirty repo 重跑 status;autofetch 低频且默认关。
- JetBrains:VCS root 检测一次性 + 文件变更增量驱动。
- gita 等纯 CLI 无常驻状态,命令触发才逐仓执行(天然按需)。
- 共识:发现 = 一次性扫描;刷新 = 事件驱动或低频;聚合网络操作 = 低频或显式触发。全仓高频轮询是反模式(大 N 时)。

## 三、对本设计的启示

| 维度 | 业界证据 | 采纳 |
|---|---|---|
| 检测 | GUI = 自动扫描 + 有界深度;manifest/手动注册属编排工具 | 自动扫描(`.git` 识别,限深,上限截断),零配置;不做 manifest、不做手动登记(后续可补) |
| 呈现 | IDE 派按 repo 分组 vs 桌面/TUI 派上下文切换 | 上下文切换(仓切换条 + 选中仓语境),与现有 cwd 语境面板零冲突;聚合计数只给活跃仓(VS Code 同款口径) |
| 聚合操作 | 交互命令必须串行;聚合 commit 有失败一半问题 | v1 不做跨仓批量操作;fetch/pull/push/stage/commit 全部单仓语境 |
| submodule | 一等公民但客户端只做导航;vendored 需扫描 | 一律平视进列表,仅按 `.git` 形态标注类型(repo / submodule / worktree),零专属语义 |
| 性能 | 发现一次性;刷新事件/低频;全仓高频轮询反模式 | 发现随 workspace 切换/手动刷新/60s 慢巡航;选中仓保留现有 5s 轮询;非选中仓不上 5s 轮询 |

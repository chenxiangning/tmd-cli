# Git 多仓支持设计:workspace 多仓库发现与仓上下文切换

日期:2026-09-07 · 状态:已落地(2026-09-07 实施;Rust 扫描原语 + GitPanel 分档 + 跨仓着色,桩目检四场景通过) · 调研底稿:[Git 多仓支持调研](../../research/git-multi-repo.md) · 配套原型:[git-multi-repo-v2.html](../../prototypes/git-multi-repo-v2.html)

## 背景与目标

客户端当前是彻底的单仓 cwd 设计:Rust 层 `with_repo` 用 `Repository::discover` 向上找仓,IPC 全部 `git_*(cwd, ...)`,消费侧(git 面板 `GitPanel.tsx`、文件树着色 `gitDecorate.tsx`)只喂 workspace 根。由此产生四个断点(root 形态 × 现状行为矩阵见调研文档 §1.2):root 非仓但含嵌套仓时 git 面板完全不可用、文件树零着色;root 内嵌仓时嵌套仓不可见不可管理。

目标:

1. workspace root 非仓但内含 N 个 git 仓库:从「完全不可用」到「零配置可用」(自动发现、选中即管理)。
2. workspace root 内嵌套仓:可见、可切入管理(上下文切换)。
3. 单仓场景(现状基线)UI 与行为零变化——回归红线。
4. 新 UI 与现有 git 能力(commit/diff/log/branch/远端对话框)完全正交:现有能力以「选中仓路径」为 cwd 原样复用,不改一行 hook。

非目标(本期明确不做):跨仓批量操作(pull all / aggregate commit)、manifest 或手动登记、monorepo 包感知、submodule 专属操作语义、checkpoints 行为变更、FS watcher 基础设施。

## 方案取舍

### 选定:自动扫描发现 + 仓上下文切换(方案 A)

- 检测学 GUI 共识(VS Code / JetBrains):一次性有界扫描,零配置。证据:桌面客户端无手动登记不可用,Tower/GitKraken 的手动列表是「多项目管理工作台」语义,与单 workspace 客户端不符。
- 呈现学桌面客户端共识(Sublime Merge / Fork / lazygit):单仓上下文 + 仓切换。理由:
  1. 改动面最小——GitPanel 的 hooks 全部收 cwd,cwd 换源即全链路生效;DiffView / 提交按钮 / 远端对话框 / 分支菜单零改动。
  2. 与现有提交流一致——单一提交按钮天然是单仓语境;分组聚合要求提交流按仓拆分,引入「逐仓失败一半」问题(gita/repo 已知坑,调研 §2.4)。
  3. 聚合计数口径清晰——±行数与文件数只给选中仓(VS Code Status Bar 同款口径),不发明跨仓 ± 行数这种无意义聚合。

### 被否决方案

| 方案 | 否决理由 |
|---|---|
| B. VS Code 式单列表按 repo 分组聚合 | DiffView/勾选态/提交按钮全链路按仓重构,改动面大;提交归属歧义(单按钮 vs 逐组按钮);本客户端右栏是 cwd 语境单视图,非 VS Code 的多 provider 专用面板;聚合 commit 有跨仓失败一半问题 |
| C. manifest / 手动注册(repo / gita 式) | 违背零配置目标;属专业编排工具领域;用户要管理嵌套仓的诉求用扫描即可覆盖;手动登记可作为后续增强(纠正扫描误报),不进本期 |
| D. FS watcher 驱动刷新 | 新增基础设施,与现有「5s 轮询 + 60s 慢巡航」纪律并行引入两套刷新模型;仓数有上限(见下),轮询够用。`ponytail:` watcher 是正确升级路径,当多仓 N > 32 或轮询实测掉帧时再做 |
| E. 聚合批量操作(pull all 等) | 交互型命令必须串行、失败一半难收场(gita 显式排除并行;repo 用 revision pin 缓解),客户端不宜吞下该复杂度 |
| F. submodule 专属语义(独立面板/update 流程) | 桌面客户端共识是「导航入口而非专属操作」(lazygit 同款);平视进列表 + 类型标注已够,`.gitmodules` update 语义留给终端 |

## 方案

### 1. Rust 侧:repo 发现原语

新文件 `src-tauri/src/git/repos_scan.rs`,`git::commands` 注册 `git_repos_scan`:

- 签名:`git_repos_scan(root: String, max_depth: u32) -> Vec<RepoSummary>`。
- `RepoSummary { path, name, branch, kind }`;`kind ∈ repo | worktree | submodule`。branch 取 HEAD shorthand,detached 时空串。
- 算法:从 root 起 BFS 找 `.git`(目录或文件),深度上限 `max_depth`(前端默认传 2);结果数上限 32,超出截断并置 `truncated: true`。`.git` 为文件(gitdir 指针)→ 读指针;root 下存在 `.gitmodules` 且命中其登记路径 → submodule,否则 worktree。`Repository::discover` 校验防误报。
- 结果按 path 排序;root 自身是仓时首个元素即 root(`isRoot` 语义由 `path == root` 表达,不另设字段)。
- 缓存:不新增缓存,复用 `with_repo` 既有 FIFO 16 句柄缓存;>16 仓逐出重建是既有语义,不扩(`ponytail:` 多仓典型 ≤10,超限时重建成本几十 ms,可观测后再调)。

### 2. IPC 与契约

- `src/kernel/gitContract.ts` 增 `RepoSummary` 类型;`ipc.ts` 增 `gitReposScan(root, maxDepth)`。契约归 kernel(跨插件:git 插件与 files 插件共同消费),仅类型与传输,零插件私有知识——符合「跨插件契约沉淀 kernel」准入。
- 消费两侧各自经 ipc 自取数据、各自持有缓存,不做共享 store(同 `gitDecorate` 数据自取先例,禁跨插件 import)。

### 3. git 插件:模式分档与仓切换条

发现时机:workspace 切换、手动 ⟳、60s 慢巡航(对齐 `useGitTotals` 纪律);发现不做 5s 轮询。新 hook `hooks/useGitRepos.ts`(收 root,返回 `repos / truncated / loading`)。

模式分档(由 `root 是否为仓` × `repos.length` 决定):

| 档位 | 条件 | 行为 |
|---|---|---|
| 单仓 | root 是仓且 repos.length == 1 | 与现状逐像素一致,不出现任何新 UI(回归红线) |
| 多仓 | repos.length >= 2 | GitRemoteBar 之上渲染仓切换条 RepoBar;面板语境 = 选中仓 |
| 非仓根有子仓 | root 非仓且 repos.length >= 1 | 空态改为发现引导列表,点击进入选中态 |
| 空态 | root 非仓且 repos.length == 0 | 现状文案「当前目录不是 Git 仓库」不变 |

- **仓切换条 RepoBar**(新文件 `views/RepoBar.tsx`,遵守 300 行铁则,`GitPanelBars` 拆分先例):横排仓 chips,每 chip = 仓名 + 类型标注(submodule/worktree 角标)+ dirty 文件数 + ↑↓;选中 chip 高亮 accent;超出横滚。chip 状态数据 = 轻量 per-repo `git_status`(branch + files.length,选中仓之外不上 5s 轮询,仅在发现周期/写操作后刷新)。
- **cwd 换源**:`GitPanel.tsx` 的 cwd 来源由 `active?.root` 改为 `selectedRepoPath ?? (root 为仓 ? root : repos[0])`,选中态存 panelStore(按 workspace 记忆,切换 workspace 失效)。hooks、DiffView、BranchView、HistoryView、远端对话框、GitRemoteBar 零改动。
- **GitToolbar 聚合口径**:±行数与文件数 = 选中仓(title 注明);新增「N 仓」徽标,仅多仓模式显示。
- **非仓根引导列表**:行 = 仓名 + branch + dirty 数 + ↑↓,点击即选中进入面板;`truncated` 时尾部提示「已截断,仅显示前 32 个」。

### 4. files 插件:跨仓着色

- `gitDecorate.tsx` 数据源:单仓不变;多仓 = 逐仓 `git_status(repoPath)` 的 files 合并(绝对路径 map 天然无碰撞),再走现有 `buildDecorationMap`。
- 目录聚合不越仓界:每仓自己的祖先聚合;仓根目录本身按该仓聚合最高优先级着色(用户能在树上一眼看出哪个仓脏)。
- 轮询纪律:跟随现有开关;开启时 5s 逐仓并行,仅多仓模式 N 为 2-10 的设计语境;`ponytail:` N 增大后的正确升级是 Rust 批量 status 命令(一次扫描逐仓汇总),届时换数据源即可,map 构建逻辑不变。
- 非仓 root:照常按发现的子仓合并着色(现状是零着色,属能力增强而非回归)。

### 5. 边界声明(不在本期范围)

- **checkpoints**:语义不动。其 `E_NOT_A_REPO` 向上 discover 行为在多仓 root 下保持现状;嵌套仓文件的捕获/还原行为不变。
- **会话 / PTY / 幕布**:零改动。cwd 是 workspace root,终端里的 git 命令自然作用于嵌套仓;幕布侧永不感知 repo 边界(PTY 硬约束不受影响)。
- **SSH / SFTP / composer**:零改动。
- **手动登记**:不做;扫描误报的纠正路径留给后续(长按 chip 排除目录之类),本期不设计。

## 验证

- 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`
- Rust(`src-tauri/` 下):`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`
- 契约测试要点:
  - `repos_scan`:嵌套发现/深度截断/32 上限/submodule 与 worktree 识别/root 自身是仓排首位;
  - GitPanel 模式分档:0/1/N 仓 × root 仓/非仓 四象限,单仓档零新 UI;
  - 着色合并:跨仓路径无碰撞、目录聚合不越仓界、单仓路径与现状输出一致。
- 目检(`pnpm tauri:dev`,UI 行为改动必做):四场景 = 单仓不变 / 多仓面板切仓 / 文件树跨仓着色 / 非仓根引导;交互对照原型 `docs/prototypes/git-multi-repo-v2.html`。
- 回归红线:单仓 workspace 下不出现仓切换条与 N 仓徽标;`gitDecorate` 单仓数据源与现输出逐项一致。

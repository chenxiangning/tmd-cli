# Proposal: 右栏 Git 面板实装(基于 git2 / libgit2)

> **状态**:Draft v0.2 · 已合入 review 修订(6×P0 / 6×P1 / 8×P2)
> **作者**:AI 联合架构师
> **关联**:替代骨架期决策"git shell-out"(原 `src-tauri/src/git.rs` 头注释)
> **布局基准**:codemoss 右栏 Git 面板外观(见 §1.3 布局契约)

---

## 0. TL;DR

右栏 Git 面板从占位空态升级为**单视图纵向三段**(工具栏 / 文件列表 / 提交框),外观对齐 codemoss 截图;后端从 `git CLI shell-out` 切到 **`git2 (libgit2 vendored)`**;实现自研,允许引入新第三方包(diff 渲染等),不搬运 codemoss 代码。

> ⚠️ **Git Graph 不在本提案范围**。见 §1.4。

---

## 1. 范围(scope)

### 1.1 IN

| 层 | 内容 |
|---|---|
| 后端 | `src-tauri/src/git.rs` → `src-tauri/src/git/{mod,status,diff,index_ops,commit,log,branch_ops,remote_ops,error,commands}.rs`;新增 `git2 = { version = "0.20", default-features = false, features = ["vendored"] }`;`rust-version` 1.77 → 1.80(用 std `LazyLock`) |
| 前端 | `src/plugins/git/` 插件内全部自研:hooks / IPC bridge / 面板组件 |
| 协议 | **15 个** `#[tauri::command]`,cwd 字符串为唯一维度 |
| 布局 | 单视图纵向三段,对齐 codemoss 外观(§1.3) |
| 集成点 | `filePanel` 注册契约不变;面板经 `useWorkspaces()` 自取活跃 cwd,**外壳零改动**(修订:不再需要 RightPanelToolbar 注入) |
| 新包政策 | 允许引入 diff 渲染 / 图标等新第三方包;每个新依赖在 tasks.md 登记必要性 |

### 1.2 OUT(显式排除)

| 内容 | 原因 |
|---|---|
| **Git Graph 视图** | 独立提案,见 §1.4;下拉中仅留 disabled 占位项 |
| 议题 / 拉取请求(GitHub) | 不接 GitHub API;codemoss 该两块依赖 OAuth + workspaceId |
| Interactive rebase / cherry-pick --edit / bisect | 需 editor 介入,面板不做;用户走幕布终端 |
| Multi-repo / Worktree | 与 `Session = cwd + PTY` 模型冲突 |
| Submodule 递归 | libgit2 默认关闭 |
| AI 生成 commit message(截图"Claude Code · 中"按钮) | 需定义"面板 → CLI session → AI → 回填"链路,独立提案;MVP **不放该按钮**(反 stub 原则) |

### 1.3 布局契约(外观参考 codemoss,实现自研)

对齐截图的单视图纵向三段:

```
┌────────────────────────────────────┐
│ ⇅ 差异Diff ▾    ⟳  ⬆N   ⊞ ☰   🌿▾ │  ① 工具栏 33px
├────────────────────────────────────┤
│ +2,495 / -163              38 文件 │  ② 聚合统计行
├────────────────────────────────────┤
│ ☑ M [ts] PluginMarketPage.tsx      │
│ ▾ 📁 kernel                        │  ③ 文件列表(树形/平铺)
│    ☐ M [ts] cli.ts                 │     checkbox = 纳入本次提交
│    ☐ U [ts] diskSessions.test.ts   │     点击行 = 展开 patch 抽屉
│    …                               │
├────────────────────────────────────┤
│ ╭──────────────────────────────╮   │
│ │ 提交信息...                   │   │  ④ 提交 composer(常驻)
│ ╰──────────────────────────────╯   │
│ 请先选择要提交的文件        [✓ 提交] │
└────────────────────────────────────┘
```

**① 工具栏**(对齐截图顶栏):
- 视图下拉「差异 Diff ▾」:`差异 Diff`(默认)/ `分支` / `历史` / `────` / `平铺` / `树形` / `────` / `Git Graph`(disabled,置灰)
- `⟳` 手动刷新;`⬆N` ahead 计数(>0 才显示,点击 = push)
- `⊞/☰` 平铺树形切换(与下拉内两项同义,快捷键位)
- `🌿▾` 当前分支名 + checkout 弹层

**③ 文件列表**:
- 状态字符:`M`(modified,琥珀)/ `A`(added,绿)/ `D`(deleted,红)/ `R`(renamed,蓝)/ `U`(untracked,porcelain `?`,灰)
- checkbox 语义:**勾选 = 提交时纳入**(提交时后端先 stage 所选再 commit,一步完成;对齐截图"请先选择要提交的文件")
- stage/unstage 的 `+/-` 行内按钮保留(高级路径),与 checkbox 正交

**④ 提交 composer**:多行输入 + 「提交」按钮;未勾选文件时按钮 disabled + 提示「请先选择要提交的文件」;amend 为输入框右侧小开关。

**布局不变量**:差异/分支/历史三个视图共用工具栏与下拉;文件列表与提交框仅属于「差异 Diff」视图。

### 1.4 为什么不接 Git Graph

截图底部 "Git Graph" 入口指向 codemoss `src/features/git-history/`——28,100 行 / 68 文件。不接的 4 个独立原因:

1. **依赖 workspaceId 多仓库管理** —— tmd `Session = cwd + PTY` 1:1,引入即架构撕裂
2. **依赖 codemoss 私有框架** —— i18n / 异步样式加载 / Workspace Picker / PR Workflow,tmd 均无
3. **独立交互图谱** —— DAG layout + branch colors + commit glyph,~40% 是可视化不是 git 调用
4. **非阻断性需求** —— 本提案的 `git_log` + `git_branches` + `git_diff_patch` 已覆盖 90% 日常决策

**落地路径**:proposal-2 `git-graph`,4 子里程碑(数据 → DAG layout → 交互 → 集成),~8 工日;数据层接口预留见 design §9。

---

## 2. 决策(decision)

### 2.1 架构大决策:git2 替代 shell-out

| 选项 | 选 / 不选 | 理由 |
|---|---|---|
| **A. git2 (libgit2, vendored)** | ✅ | typed API、Index 原子写、diff rename 检测、无 fork/解析边界 |
| B. 继续 shell-out | ❌ | fork 抖动、porcelain/quotepath/color 环境差异、stage 多步非原子 |
| C. git2 系统依赖(非 vendored) | ❌ | 打包不可控 |
| D. git2 + 远端操作兜底 shell-out | ✅ | fetch/pull/push 凭据链(ssh-agent/GCM/netrc)由 git CLI 自带 |

**v0.2 修订**:shell-out 兜底命令必须设 `GIT_TERMINAL_PROMPT=0` + `GIT_SSH_COMMAND="ssh -o BatchMode=yes"`,禁止交互 prompt 挂死 UI(SSH passphrase 场景);失败文案引导用户去幕布终端执行(有 PTY 可交互)。

### 2.2 cwd 单维度

不引 `workspaceId`。所有命令签名 `(cwd: String)`;面板经 `useWorkspaces()` 的 `activeId → root` 自取 cwd,**外壳零改动**(修订点:v0.1 的"RightPanelToolbar 注入 cwd"取消,`files` 插件已有同款消费模式可复用)。

### 2.3 Repo 句柄缓存(修订:单层)

**事实修正**:`git2::Repository` 在 git2 0.20 中显式 `unsafe impl Send + Sync`(内部状态由 libgit2 自管锁)。v0.1 的双层 Mutex 作废。

```rust
static REPO_CACHE: LazyLock<Mutex<HashMap<PathBuf, Arc<Repository>>>>;
```

- 外层 `parking_lot::Mutex` 仅 lookup/insert,临界区纳秒级
- `Arc<Repository>` 直接共享,无内层锁
- **失效策略修订**:写操作(commit/checkout/stage/discard)由后端内部 evict,**不暴露 IPC 命令**;不依赖前端记得调 invalidate
- **Index stale 防线**:每次 `repo.index()` 后立即 `index.read(true)` 强制重读磁盘 —— 用户在幕布终端 `git add` 后,面板下一次操作必须看到最新 index
- 外部 checkout 不 stale:`repo.head()` 每次重新解析 ref

### 2.4 面板布局:单视图纵向三段(修订)

v0.1 的「三段 Tab(Working/Commit/Branch)」作废,改为 §1.3 的单视图:

| 视图(下拉切换) | 内容 |
|---|---|
| 差异 Diff(默认) | 聚合行 + 文件列表 + 提交 composer |
| 分支 | 本地/远程列表 + 创建/删除/checkout |
| 历史 | `git log` 摘要列表,点 commit 展 patch 抽屉 |

**理由**:截图工作流是"挑文件 → 写消息 → 提交"一屏完成,Tab 拆分会把提交框藏到另一页,违背参考外观。

### 2.5 错误语义(修订:结构化前缀)

Tauri `Err(String)` 携带机器可匹配前缀,前端不再 grep 中文文案:

| 前缀 | 场景 | UI 处理 |
|---|---|---|
| `E_NOT_A_REPO:` | cwd 不在 git 仓库 | 空态"当前目录不是 Git 仓库" |
| `E_EMPTY:` | 输入校验(空 message / 无变更) | 按钮 disabled + inline hint |
| `E_GIT2:` | libgit2 错误 | toast |
| `E_SHELL:` | fetch/pull/push 失败 | toast + 引导去终端 |
| `E_AUTH:` | 远端凭据失败(BatchMode 拒绝) | toast + 明确"请在终端执行一次以完成凭据交互" |

### 2.6 ahead/behind 独立命令(修订)

`status` 不再返回 ahead/behind(`graph_ahead_behind` 是 revwalk,长历史仓库每 5s 轮询代价不可接受)。独立 `git_ahead_behind` 命令,触发点:fetch 完成后 / 分支视图打开时 / 手动 ⟳。

### 2.7 数据刷新策略(新增 trade-off 声明)

MVP 用**轮询**:`status` 5s interval,窗口失焦(`document.visibilitychange`)时停。已知代价:大仓库 IO 抖动 + 电池。后续路径:`notify` crate 监听 `.git/index` 与 `HEAD` mtime 改事件驱动 —— 列为 proposal-3 候选,本提案不做。

---

## 3. 实现拆解

### 3.1 文件改动清单

```
src-tauri/
├── Cargo.toml          (+git2 vendored;rust-version 1.77→1.80)
└── src/git/
│   ├── mod.rs          Repo 缓存(Arc 单层)+ with_repo + 内部 evict
│   ├── status.rs       branch + 变更清单(detached HEAD 安全)
│   ├── diff.rs         Patch::from_diff 取 patch(修订 v0.1 假 API)
│   ├── index_ops.rs    stage(含 deleted)/ unstage(reset_default)/ discard
│   ├── commit.rs       tree_id 空提交检查 + signature fallback
│   ├── log.rs          revwalk 摘要
│   ├── branch_ops.rs   list / checkout / create / delete
│   ├── remote_ops.rs   shell-out fetch/pull/push(GIT_TERMINAL_PROMPT=0)
│   ├── error.rs        E_* 结构化前缀
│   └── commands.rs     15 个 #[tauri::command]
(旧 src-tauri/src/git.rs 删除)

src/plugins/git/
├── index.tsx           注册(契约不变)
├── GitPanel.tsx        单视图:工具栏 + 下拉 + 三视图切换
├── views/
│   ├── DiffView.tsx    聚合行 + FileList + patch 抽屉 + 提交 composer
│   ├── BranchView.tsx  本地/远程 + 创建/删除/checkout
│   └── HistoryView.tsx log 摘要 + commit patch 抽屉
├── hooks/
│   ├── useGitStatus.ts     5s 轮询 + visibility 暂停 + 显式 refresh
│   ├── useGitDiffs.ts      文件清单 + patch LRU(50)
│   ├── useGitBranches.ts   分支视图激活时才拉
│   └── useGitLog.ts        历史视图激活时才拉
├── gitOperations.ts    IPC bridge(15 方法)
└── types.ts            对齐 Rust serde camelCase

(外壳 0 改动)
```

### 3.2 命令清单(15 个,数字全篇统一)

| # | 命令 | 签名 | 实现 |
|---|---|---|---|
| 1 | `git_status` | `(cwd)` → `DiffStatus` | status::compute |
| 2 | `git_ahead_behind` | `(cwd)` → `{ahead, behind, upstream}` | status::ahead_behind(低频) |
| 3 | `git_diff_files` | `(cwd, staged)` → `Vec<FileDelta>` | diff::list |
| 4 | `git_diff_file_patch` | `(cwd, path, staged)` → `Option<FilePatch>` | diff::file_patch |
| 5 | `git_stage` | `(cwd, paths)` | index_ops::stage |
| 6 | `git_unstage` | `(cwd, paths)` | index_ops::unstage |
| 7 | `git_discard` | `(cwd, paths)` | index_ops::discard(不动 untracked) |
| 8 | `git_commit` | `(cwd, paths, input)` → `sha` | 先 stage 所选再 commit(原子"勾选+提交") |
| 9 | `git_log` | `(cwd, limit, offset)` → `Vec<LogEntry>` | log::walk |
| 10 | `git_branches` | `(cwd)` → `{local, remote}` | branch_ops::list_all |
| 11 | `git_checkout` | `(cwd, name)` | branch_ops::checkout |
| 12 | `git_create_branch` | `(cwd, name, from?)` | branch_ops::create |
| 13 | `git_delete_branch` | `(cwd, name, force?)` | branch_ops::delete |
| 14 | `git_fetch` | `(cwd)` → stdout | remote_ops::run(Fetch) |
| 15 | `git_pull_push` | `(cwd, op: "pull"|"push", branch?)` → stdout | remote_ops::run |

### 3.3 性能与缓存

| 操作 | 策略 |
|---|---|
| `status` | 5s 轮询,失焦停;写操作完成后立即 refresh |
| `diff_patch` | LRU 50,key = `cwd\0path\0staged` |
| `log` | limit=50 分页 append |
| `branches` | 分支视图激活时拉 + 操作后 refresh |
| `ahead_behind` | 事件驱动,不轮询 |

### 3.4 安全

| 风险 | 缓解 |
|---|---|
| SSH/GCM 交互 prompt 挂死 | `GIT_TERMINAL_PROMPT=0` + BatchMode;失败引导终端 |
| discard 误删 untracked | `CheckoutBuilder` 不设 `remove_untracked`(默认 false),仅还原已跟踪文件 |
| commit message 注入 | libgit2 内存 API,不经 shell |
| Path traversal | cwd 仅来自 session 注册表,不接受外部输入 |

---

## 4. 验收(acceptance criteria)

### 4.1 自动化

- [ ] `cargo build` macOS arm64 通过(git2 vendored)
- [ ] 15 个命令各 ≥1 个 happy path 单测(tempdir 建临时 repo)
- [ ] 错误契约单测:非仓库目录 → `E_NOT_A_REPO:` 前缀;空 message → `E_EMPTY:`
- [ ] `pnpm typecheck` / `pnpm vitest run` / `pnpm check:file-size` / `pnpm check:arch-boundary` 全绿

### 4.2 手动验证(9 步,必须全过)

| Step | 期望 |
|---|---|
| 1. 打开 git 仓库 session | 右栏 Git 面板显示工具栏 + 分支名 |
| 2. 改一个文件 | ≤5s 出现 M 行,聚合行数字更新 |
| 3. 勾选文件 → 写消息 → 提交 | 一次点击完成 stage+commit;列表清空;log 出现新 commit |
| 4. 点文件行 | patch 抽屉展开,+/- 行着色 |
| 5. 空提交(不勾文件) | 按钮 disabled +「请先选择要提交的文件」 |
| 6. 分支视图 checkout 其他分支 | 工作区刷新,工具栏分支名变更 |
| 7. 创建 `feat/test` 分支 | 出现在本地列表,HEAD 标记正确 |
| 8. 有 ahead 时点 ⬆N | push 成功或返回 `E_SHELL:`/`E_AUTH:` 可读错误 |
| 9. 非 git 目录 session | 空态「当前目录不是 Git 仓库」,无报错 toast |

### 4.3 打包验收(修订:无 CI 前提下降级)

repo 当前无 CI 工作流(`.github/` 空)。验收降级为**实机验证**:
- [ ] macOS arm64:`pnpm build:mac-arm64` 通过,产物体积涨幅 < 5MB
- [ ] Windows/Linux:首次跨平台打包时验证,tasks.md 留检查项;失败时按 §5.1 缓解路径处理

### 4.4 回归

- [ ] PTY 启动路径不引入 git2 初始化(LazyLock 首次访问才加载)
- [ ] 启动时间涨幅 < 200ms
- [ ] 面板在失焦窗口 0 轮询(DevTools Performance 验证)

---

## 5. 风险与回滚

### 5.1 主要风险

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| libgit2-sys 在 Windows GNU / Linux musl 编译失败 | 中 | 高 | 切 `features = []` 系统依赖 + 打包脚本补;tasks.md 预留任务 |
| 大仓库(10w+ 文件)status 轮询卡顿 | 低 | 中 | `StatusOptions` 已 exclude ignored;proposal-3 换 notify 事件驱动 |
| vendored libgit2 与 rusqlite bundled sqlite 共存 | 低 | 高 | [推断]两库符号均命名空间隔离,无已知冲突;打包验证覆盖 |
| 用户同名分支并发操作(终端 + 面板) | 中 | 低 | `index.read(true)` + head 每次重解析;写操作后 evict |

### 5.2 回滚

单 commit revert。边界:`src-tauri/src/git/` 目录 + `src/plugins/git/` 目录 + Cargo.toml 1 行 + rust-version 1 行。无迁移状态、无破坏性 commit。

---

## 6. 里程碑

| 里程碑 | 工日 | 内容 | 验收 |
|---|---|---|---|
| **M1 后端壳子** | 1d | git2 vendored + status/commands 框架 + 错误前缀 | sample repo 显示 status |
| **M2 索引 + diff + 差异视图** | 2d | stage/unstage/discard/commit + diff + DiffView + 提交 composer | 手动 step 1-5 |
| **M3 分支 + 历史视图** | 1.5d | branches/log + BranchView/HistoryView | 手动 step 6-7 |
| **M4 remote + polish** | 1d | fetch/pull/push + BatchMode + LRU + 打包验证 | 手动 step 8-9 + macOS 打包 |

**总计 ~5.5 工日 / ~3200 行**(后端 ~1400 + 前端 ~1800)。

---

## 7. 后续提案队列

| 提案 | 内容 | 前置 |
|---|---|---|
| proposal-2 git-graph | 下拉第 4 项启用;DAG 数据层 + 渲染 | 本提案验收 |
| proposal-3 git-events | notify 监听 .git/index 替代轮询 | 本提案验收 |
| proposal-4 commit-ai | 提交 composer 的 AI 生成按钮(经 CLI session 链路) | composer 插件事件契约 |

---

## 8. 评审检查清单

- [ ] §2.1 git2 vendored + BatchMode 兜底同意?
- [ ] §2.3 单层 Arc 缓存 + 后端自动 evict + `index.read(true)` 同意?
- [ ] §2.4 单视图三段布局(废弃 v0.1 三 Tab)对齐截图?
- [ ] §2.5 E_* 结构化错误前缀同意?
- [ ] §2.6 ahead/behind 独立命令同意?
- [ ] §1.2 AI 生成按钮 MVP 砍掉同意?
- [ ] §4.3 验收降级(无 CI)接受?
- [ ] §5.2 单 commit 回滚足够?

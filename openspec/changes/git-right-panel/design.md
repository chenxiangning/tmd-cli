# Design: 右栏 Git 面板(基于 git2 / libgit2)

> **配套**:`proposal.md`(决策层)+ `tasks.md`(执行层)
> **本文**:技术拐点的 why、已修正的实现细节、UI 布局契约
> **v0.2**:合入 review 修订。每节标注修正点。

---

## 1. libgit2 vs shell-out:拐点

### 1.1 shell-out 的隐式成本

```
Command::new("git").args(["-C", cwd, "diff", ...]).output()
  ↓ fork+exec(高频 diff 路径抖动)
  ↓ stdout 文本解析(用户 .gitconfig: quotePath / color.ui / pager 均改变输出)
  ↓ 字符编码(HFS+ NFD vs NFC)
  ↓ stage 要再走 update-index —— 多次 fork,中途失败 Index 停留中间态
```

### 1.2 libgit2:边界只有一个

```rust
let repo = Repository::discover(cwd)?;
let statuses = repo.statuses(Some(&mut opts))?;
// typed API,无 fork,无 parse
```

### 1.3 决定性理由:Index 原子性

```
shell-out: update-index --add A  ← fork 1
           update-index --add B  ← fork 2(若失败,A 已进 index,半状态)
           commit                 ← fork 3

libgit2:   index.add_path(A)?; index.add_path(B)?;
           index.write()?;      ← 原子落盘
           repo.commit(...)?;   ← 原子 commit
```

---

## 2. Repo 缓存并发模型(v0.2 修正)

### 2.1 事实修正:Repository 是 Send + Sync

git2 0.20 的 `Repository` 显式 `unsafe impl Send + Sync`,内部状态由 libgit2 自管。**v0.1 的双层 Mutex 作废**。

```rust
use parking_lot::Mutex;
use std::sync::{Arc, LazyLock};

static REPO_CACHE: LazyLock<Mutex<HashMap<PathBuf, Arc<Repository>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn with_repo<T>(cwd: &str, f: impl FnOnce(&Repository) -> Result<T, GitError>)
    -> Result<T, GitError>
{
    let key = canonicalize_cwd(cwd)?;
    let cached = REPO_CACHE.lock().get(&key).cloned(); // 外层锁当场释放
    let repo = match cached {
        Some(arc) => arc,
        None => {
            let arc = Arc::new(
                Repository::discover(&key).map_err(GitError::not_a_repo)?,
            );
            REPO_CACHE.lock().insert(key, arc.clone());
            arc
        }
    };
    f(&repo)
}
```

- 外层锁只做 lookup/insert,**锁内零 git2 调用** → 无锁顺序问题
- 同 repo 并发调用由 libgit2 内部锁串行,正确性由上游保证
- `LazyLock` 要求 rust-version ≥ 1.80(Cargo.toml 同步升级)

### 2.2 Index stale 防线(新增)

libgit2 的 `Index` 是内存缓存,**外部 `git add`(用户在幕布终端)后不会自动更新**:

```rust
fn fresh_index(repo: &Repository) -> Result<git2::Index, GitError> {
    let mut index = repo.index()?;
    index.read(true)?; // 强制重读磁盘
    Ok(index)
}
```

所有 index 操作(stage/unstage/commit)必须经 `fresh_index` 入口。这是唯一必须显式处理的 stale 源;`head()`/`statuses()`/`diff` 每次都重新解析,天然新鲜。

### 2.3 失效策略(v0.2 修正:后端自治)

- 写操作(commit/checkout/discard/branch_delete)成功后,后端内部 `REPO_CACHE.lock().remove(&key)`
- **不暴露 invalidate IPC 命令** —— 正确性不依赖前端记得调
- 前端只需在写操作 resolve 后 `refresh()` 重拉数据

---

## 3. 关键函数修正(v0.1 review 的 6 个 P0)

### 3.1 diff::file_patch —— Patch::from_diff 正确路径

```rust
pub fn file_patch(
    repo: &Repository, path: &str, staged: bool,
) -> Result<Option<FilePatch>, GitError> {
    let diff = build_diff(repo, staged)?;
    // ① 先经 deltas() 找到序号(v0.1 错用不存在的 Diff::to_buf)
    let idx = diff.deltas().enumerate().find_map(|(i, d)| {
        let hit = d.new_file().path().and_then(|p| p.to_str()) == Some(path)
            || d.old_file().path().and_then(|p| p.to_str()) == Some(path);
        hit.then_some(i)
    });
    let Some(idx) = idx else { return Ok(None) };
    // ② Patch::from_diff 拿单文件 patch
    let mut patch = git2::Patch::from_diff(&diff, idx)?;
    let buf = patch.to_buf()?;
    let delta = diff.get_delta(idx).ok_or(GitError::empty("delta lost"))?;
    Ok(Some(FilePatch {
        path: path.into(),
        old_path: delta.old_file().path()
            .map(|p| p.to_string_lossy().into_owned()),
        kind: fold_delta(delta.status()),
        additions: patch.line_stats()?.1 as u32,   // (ctx, adds, dels)
        deletions: patch.line_stats()?.2 as u32,
        patch: String::from_utf8_lossy(&buf).into_owned(),
        binary: delta.new_file().is_binary() || delta.old_file().is_binary(),
    }))
}
```

### 3.2 index_ops —— 三个函数全部重写

```rust
/// stage:新增/修改走 add_path;已删除走 remove_path(v0.1 漏 deleted 分支)
pub fn stage(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    let workdir = repo.workdir().ok_or(GitError::empty("bare repo"))?;
    let mut index = fresh_index(repo)?;
    for p in &paths {
        let rel = Path::new(p);
        if workdir.join(rel).exists() {
            index.add_path(rel)?;
        } else {
            index.remove_path(rel)?; // git add 等价语义:删除也入 index
        }
    }
    index.write()?;
    Ok(())
}

/// unstage:v0.1 手搓 IndexEntry 会留下 stat 全 0 的"幽灵脏文件";
/// 正解是 libgit2 内置的 reset_default(≡ git reset -- <paths>)
pub fn unstage(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    let head = repo.head()?.peel(git2::ObjectType::Commit)?;
    repo.reset_default(&head, paths.iter().map(Path::new))?;
    Ok(())
}

/// discard:v0.1 调了不存在的方法且 remove_untracked(true) 是数据炸弹。
/// 只还原已跟踪文件;untracked 文件绝不能动。
pub fn discard(repo: &Repository, paths: Vec<String>) -> Result<(), GitError> {
    let mut opts = git2::build::CheckoutBuilder::new();
    for p in &paths { opts.path(p); }
    opts.force(); // 不 set remove_untracked → 默认保留 untracked
    repo.checkout_head(Some(&mut opts))?;
    Ok(())
}
```

### 3.3 commit —— tree_id 比较 + 勾选提交原子化

```rust
/// paths 非空时先 stage(布局契约:checkbox 勾选 + 提交 = 一步)
pub fn commit(repo: &Repository, paths: Vec<String>, input: CommitInput)
    -> Result<String, GitError>
{
    if input.message.trim().is_empty() {
        return Err(GitError::empty("commit message 不能为空"));
    }
    if !paths.is_empty() {
        stage(repo, paths)?; // 同进程内顺序执行,index.write 原子
    }
    let mut index = fresh_index(repo)?;
    let tree_oid = index.write_tree()?;

    let head_commit = repo.head().ok()
        .map(|r| r.peel_to_commit()).transpose()?;

    // 空提交防线:v0.1 错把 commit OID 与 tree OID 比较,恒 false
    if !input.amend {
        if let Some(hc) = &head_commit {
            if hc.tree_id() == tree_oid {
                return Err(GitError::empty("无变更需要提交"));
            }
        }
    }

    let sig = resolve_signature(repo)?; // author = committer = config user.* + env fallback
    let parents: Vec<Commit> = match (input.amend, head_commit) {
        (true, Some(hc)) => hc.parents().collect(),
        (_, Some(hc)) => vec![hc],
        _ => vec![], // 首个 commit
    };
    let parents_ref: Vec<&Commit> = parents.iter().collect();
    let tree = repo.find_tree(tree_oid)?;
    let oid = repo.commit(Some("HEAD"), &sig, &sig,
                           input.message.trim(), &tree, &parents_ref)?;
    evict(repo); // 写操作后内部 evict
    Ok(oid.to_string())
}

/// v0.1 的 is_author 分支是假的(两路同值);git config 本就同一组 user.name/email
fn resolve_signature(repo: &Repository) -> Result<Signature<'static>, GitError> {
    let cfg = repo.config()?;
    let name = cfg.get_string("user.name").ok()
        .or_else(|| std::env::var("GIT_AUTHOR_NAME").ok())
        .unwrap_or_else(|| "tmd-cli".into());
    let email = cfg.get_string("user.email").ok()
        .or_else(|| std::env::var("GIT_AUTHOR_EMAIL").ok())
        .unwrap_or_else(|| "tmd-cli@localhost".into());
    Ok(Signature::now(&name, &email)?)
}
```

### 3.4 status —— detached HEAD 安全 + 不伪造 lifetime

```rust
pub fn compute(repo: &Repository) -> Result<DiffStatus, GitError> {
    let head = repo.head()?;
    let head_sha = head.target().map(|o| o.to_string()).unwrap_or_default();
    let is_detached = !head.is_branch(); // ① 先判,再 wrap
    let branch = if is_detached {
        format!("detached@{}", &head_sha[..7.min(head_sha.len())])
    } else {
        head.shorthand().unwrap_or("HEAD").to_string()
    };
    // ② upstream 信息拆到独立函数,返回数据值(String/Oid),
        //    不返回 Reference —— v0.1 的 Reference<'static> 是伪造 lifetime
    let upstream = if is_detached { None } else { upstream_name(repo, &head) };
    // ... porcelain 折叠逻辑不变
}

/// 低频命令用;不挂进 5s 轮询
pub fn ahead_behind(repo: &Repository) -> Result<AheadBehind, GitError> {
    let head = repo.head()?;
    if !head.is_branch() { return Ok(AheadBehind::default()); }
    let local = head.target().ok_or(GitError::empty("head no target"))?;
    let up = git2::Branch::wrap(head).upstream()
        .map_err(|_| GitError::empty("no upstream"))?;
    let up_oid = up.get().target().ok_or(GitError::empty("up no target"))?;
    let (ahead, behind) = repo.graph_ahead_behind(local, up_oid)?;
    Ok(AheadBehind {
        ahead: ahead as i32, behind: behind as i32,
        upstream: up.name()?.map(str::to_string),
    })
}
```

---

## 4. remote_ops —— 凭据交互防线(v0.2 修正)

```rust
pub fn run(cwd: &str, op: RemoteOp, branch: Option<String>) -> Result<String, GitError> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd)
        // SSH passphrase / GCM 弹窗在 Tauri 子进程里无 TTY,会永久挂死 UI。
        // 双保险:禁 terminal prompt + ssh BatchMode。
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes");
    // pull 尊重用户 pull.rebase 配置;失败由 E_SHELL 文案引导去幕布终端
    match op { /* fetch / pull / push 组 args */ }
    let out = cmd.output().map_err(|e| GitError::shell(e.to_string()))?;
    let combined = merge(&out.stdout, &out.stderr);
    if !out.status.success() {
        return Err(GitError::auth_or_shell(&combined)); // 含 "Permission denied"/"authentication" → E_AUTH
    }
    Ok(combined)
}
```

时机说明:`lib.rs` 的 `enriched_path` 后台线程在建窗后落地,git 面板命令全部由前端 IPC 触发(必然晚于建窗),裸命令名 `git` 解析安全。

---

## 5. 错误传播:结构化前缀(v0.2 修正)

```rust
impl From<GitError> for String {
    fn from(e: GitError) -> Self {
        match e {
            GitError::NotARepo(p) => format!("E_NOT_A_REPO: {p}"),
            GitError::Empty(m)    => format!("E_EMPTY: {m}"),
            GitError::Libgit2(e)  => format!("E_GIT2: {}", e.message()),
            GitError::Shell(s)    => format!("E_SHELL: {s}"),
            GitError::Auth(s)     => format!("E_AUTH: {s}"),
        }
    }
}
```

前端匹配 `msg.startsWith("E_NOT_A_REPO")`,不再 grep 中文(文案可自由迭代,契约不破)。

---

## 6. Composer 联动(v0.2 重写 —— v0.1 是事故设计)

**v0.1 错误**:把 `/git commit ${msg}` 反射回 PTY —— omp/pi/codex 都不认识该命令,文本会作为 prompt 发给 LLM,AI 可能据此执行任意操作。用户在 GUI 点「提交」的预期是本地原子操作,不是"请 AI 代劳"。

**v0.2 契约:纯事件总线,零 PTY 反射**:

```
git 面板 ←(git://composer-prefill { msg })— composer 插件
  │        仅预填提交框,不执行
  └─ 提交执行唯一入口:面板「✓ 提交」按钮 → git_commit IPC
```

- composer 侧:用户输入 `/commit <msg>` 时**只 emit 事件**,文本仍按原逻辑发给 CLI(交给 CLI 自己处理,git 插件不拦截)
- git 侧:监听事件 → 切差异视图 → 预填消息框 → 用户人工确认后点提交
- **执行权永在面板按钮**,AI/CLI 无法绕过人工确认触发 commit

---

## 7. patch 缓存与渲染

LRU 50,key = `cwd\0path\0staged`(`Map` 插入序实现,代码同 v0.1,略)。

渲染 MVP:DOM 文本渲染,+/- 行背景色。**新包政策**:允许引入 `react-diff-view` 或同类(登记 tasks.md);>5k 行 patch 的虚拟滚动/Canvas 列为后续优化,不在本提案。

---

## 8. UI 布局契约(对齐 codemoss 外观)

### 8.1 结构映射

| 截图元素 | tmd 组件 | 数据源 |
|---|---|---|
| 「差异 Diff ▾」下拉 | `ViewSwitcher`(工具栏左) | 本地 state |
| ⟳ / ⬆44 / ⊞☰ / 🌿 | `ToolbarActions` | useGitStatus / useAheadBehind |
| `+2495 / -163` `38` | `AggregateRow` | DiffStatus.files 聚合 |
| M/U + TS 图标 + 文件名 | `FileList` / `FileRow` | DiffStatus.files |
| 目录折叠(kernel/) | 树形模式 `FileTree` | 平铺/树形切换 |
| 提交信息输入框 | `CommitComposer` | 本地 state |
| 「请先选择要提交的文件」 | composer hint | checkedPaths.isEmpty |
| ✓ 提交 | submit 按钮 | git_commit IPC |
| (截图无)patch 抽屉 | `PatchDrawer` | git_diff_file_patch |

### 8.2 视觉令牌

复用现有 theme tokens(`--tmd-*`),不自造色值:

| 语义 | token |
|---|---|
| M 琥珀 | `--tmd-warn` |
| A 绿 | `--tmd-success` |
| D 红 | `--tmd-danger` |
| U 灰 | `--tmd-fg-faint` |
| 选中行 | `--tmd-accent` 15% 透明 |
| +行背景 | success 10%;-行背景 danger 10%;@@ 行 sky |

(实现时对不上的 token 在 `themeTokens.ts` 增量登记,不在组件里写死 hex。)

### 8.3 交互细则

- 点击文件行 → 展开/收起 patch 抽屉(行内展开,不弹窗)
- checkbox 与行点击区域分离(8px 隔离带,防误触)
- `⟳` 旋转动画仅手动触发时播放,轮询静默
- 提交中按钮 spinner + 禁输入;成功 toast "已提交 abc1234"
- 分支视图 checkout 有未提交变更时:先弹 confirm(文案含"可能被覆盖")再走 `CheckoutBuilder::safe`(libgit2 自身也会拒)

---

## 9. Git Graph 数据层预留

```rust
// proposal-2 才实装;此处仅冻结签名
#[tauri::command]
pub fn git_walk_graph(cwd: String, root: Option<String>, depth: u32)
    -> Result<GraphData, String>;

pub struct GraphNode {
    sha: String, parents: Vec<String>, // DAG 边
    summary: String, author_when: i64,
}
```

前端下拉中「Git Graph」项 MVP 期间 disabled + tooltip「后续版本提供」。

---

## 10. 命名一致性

| Rust | TS | UI 中文 |
|---|---|---|
| `DiffStatus.files[]` | `files[]` | 差异列表 |
| `FileStatus.status = "M"/"A"/"D"/"R"/"?"` | 同 | M/A/D/R/U(U 即 untracked,porcelain `?`) |
| `FilePatch.patch` | `string` | (raw diff) |
| `AheadBehind.{ahead,behind,upstream}` | 同 | ⬆N / ⬇N |
| `LogEntry.summary` | 同 | 提交摘要 |
| `CommitInput.amend` | `boolean` | 修补上次提交 |

---

## 11. 评审检查清单(细节层)

- [ ] §2.1 单层 Arc 缓存 —— 同意?(依赖事实:git2 0.20 Repository 是 Send+Sync)
- [ ] §2.2 `index.read(true)` 强制重读 —— 每次 index 操作都走 `fresh_index`,无例外?
- [ ] §3.2 discard 不动 untracked —— 与直觉一致?(用户"放弃改动"的语义不含删新文件)
- [ ] §4 BatchMode 失败后引导终端 —— 文案可接受?
- [ ] §6 提交执行权永在面板按钮 —— 同意作为安全不变量?
- [ ] §7 diff 渲染新包(react-diff-view 级)引入政策 —— 同意?
- [ ] §8.2 token 缺口登记机制 —— 同意?

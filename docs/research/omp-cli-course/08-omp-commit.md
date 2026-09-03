# 第八课:`omp commit` 与 git 深度集成

这是 omp 的 16 号电池。`omp commit` 不是 `git commit` 的别名——它让 agent 参与"怎么提交"这件事本身。

> 先给一句话版本:**CLI 层可验证的是"生成 commit message + 更新 changelog + 自动暂存";"自动拆成原子 commit"是上游 README 宣传的行为(16 号电池),本课分开标注,不把宣传当文档。**

## 1. 一句话定位

```
git commit -am "改动"          → 一次提交所有改动,可能混进无关内容
omp commit                     → agent 读工作区,生成 message,自动暂存提交,顺手更新 changelog
```

适用场景:

- 干完活想提交,但 message 写不好/不想写
- 想让 CHANGELOG 跟着每次提交走
- 工作区里混了几件不相关的事,希望提交有语义(README 口径)

## 2. CLI 可验证的部分

```bash
omp commit --help    # 看完整 flag
```

- **生成 commit message**:agent 读工作区改动,写符合项目风格的 message
- **更新 changelog**:维护 CHANGELOG 的仓库,提交时同步更新(release notes 里多次出现"omp commit 更新 changelog"的修复记录,说明这是主路径)
- **自动暂存**:会自己 `git add` 该 add 的文件——v18.1.6 修过一个 bug:macOS Unicode 规范化(NFD/NFC)产生的重复文件曾被误含进自动暂存
- 与之配套的还有 `/commit` 会话内流程和 agent 侧提交工具链(内部工具,不在 31 个公开工具清单里)

## 3. README 宣传的部分:原子拆分(16 号电池)

上游 README §16 原文要点(逐条对照翻译):

> "omp reads the working tree through git_overview, git_file_diff, and git_hunk, then splits unrelated changes into atomic commits ordered by their dependencies. Cycles are rejected before anything is written. Source files score above tests, docs, and configs, so the headline commit is the one that matters. Lock files are excluded from analysis entirely."

| README 主张 | 含义 |
| ------ | ------ |
| `git_overview` / `git_file_diff` / `git_hunk` | 提交流程的内部工具:工作区全景 → 单文件 diff → 单 hunk 精确到行(**不是公开的 31 工具,是 commit 流程内部件**) |
| atomic commits ordered by dependencies | 无关改动拆开,按依赖顺序提交 |
| Cycles are rejected | region (一组相关改动) 之间有循环依赖 → 拒绝拆分,合成一个 commit,避免"先提交的那个编译不过" |
| Source > tests > docs > configs | 优先级评分,核心代码的 commit 排前面 |
| Lock files excluded | `package-lock.json` / `pnpm-lock.yaml` / `Cargo.lock` 等不参与分析 |

> 实践建议:这些行为以你手上的版本实测为准(`omp commit` 是纯 CLI,试一次就知道当前版本拆不拆、怎么拆)。README 描述的是设计意图,omp 迭代极快,行为可能随版本微调。

## 4. commit message 怎么写

omp 默认按 **Conventional Commits (约定式提交规范)** 风格生成:type (类型, feat/fix/refactor) + scope (作用域) + body (为什么改)。message 由 `commit` role 的模型生成——所以第一课的 `modelRoles.commit` 在这里生效:

```yaml
modelRoles:
  commit: openai-codex/gpt-5.5   # 写 message 用的模型
```

想要中文 message / 特定格式:给项目配规则(AGENTS.md / `.omp/rules/`,第十一课),agent 写 message 时会遵守。

## 5. 周边的 git 能力(同样重要)

### 5.1 `omp git`:交互式全屏 git UI

```bash
omp git
```

- 分屏:左侧 diff 查看器 + 右侧 staging (暂存区) 边栏 + 底部 commit composer (提交编写器)
- 快捷键:`r` 刷新 / `s` stage / `u` unstage / `space` 逐 hunk 切换 / `1-4` 切 diff 视图 / `c` 提交,支持 vim motions
- v18.0.7 起专门做过响应性优化

### 5.2 pi-vcs:双 VCS 后端

Rust crate `pi-vcs`(v18.0.9 引入)把 VCS 操作做成**后端中立 API**:

- **Git 走 gitoxide**(纯 Rust 实现;git 二进制只在需要凭据的网络传输等场景兜底)
- **Jujutsu 走 jj-lib**——`omp` 能直接操作 jj 仓库
- VCS 操作的 panic 会以结构化 `VcsError` 返回,而不是把进程炸了

### 5.3 worktree 管理

```bash
omp worktree ls      # 列出 agent 管理的 worktree(~/.omp/wt)
omp wt clear         # 清理
```

- 第三课的 `isolated` 子代理就跑在这类隔离工作区里(APFS/Btrfs/ZFS reflink/overlayfs)
- v18.1.5 起 worktree 创建改为 **clone-first**(先克隆再摘工作树,大仓库更快更省),并新增 `omp worktree add` 与 `/wt` 斜杠命令(可带着未提交变更迁移会话)

## 6. /commit 命令 vs omp commit vs git commit

| | `git commit -m "..."` | `omp commit` |
| --- | ------ | ------ |
| Message | 你自己写 | ✅ agent 写(commit role) |
| changelog | 手动 | ✅ 自动更新 |
| 拆 commit | ❌ 一次提交所有 | ✅ README 口径:按依赖拆原子提交 |
| 循环依赖 | ❌ | ✅ README 口径:拆前拒绝 |
| lockfile | 混进 commit | ✅ README 口径:排除在分析外 |

## 7. 实战

### 场景 1:周末改了一堆东西,周一想提交

```text
[用户]
把工作区的改动提交了,changelog 记得更新。

[agent]
1. 读工作区改动(git status / diff / 内部 git_* 工具)
2. 识别几块无关改动(auth / rate limit / README)
3. 逐块生成 Conventional message,按依赖顺序提交
4. CHANGELOG.md 追加条目
```

### 场景 2:只看某文件改动

```bash
omp git          # 全屏 UI 里翻
# 或在会话里让 agent 跑 git diff -- <file>(bash 工具直出)
```

### 场景 3:Jujutsu 仓库

```text
[用户]
这是个 jj 仓库,把工作区提交进 desc 里写好的 change。
[agent]
→ 走 pi-vcs 的 jj 后端,直接操作,不需要装 git 桥接
```

## 小结

| 武器 | 干什么 | 状态 |
| ------ | -------- | ------ |
| `omp commit` | 生成 message + changelog + 自动暂存 | CLI 可验证 |
| 原子拆分/cycle 拒绝/优先级 | 无关改动拆开按依赖提交 | README 宣传(16 号电池) |
| `omp git` | 全屏 diff/staging/commit UI | CLI 可验证 |
| `pi-vcs` | gitoxide + Jujutsu 双后端 | v18.0.9 起 |
| `omp worktree` / `/wt` | 隔离工作区管理 | v18.1.5 clone-first |

和 pi 的对照:**pi 把"改完"和"提交"分开,omp 把"提交"也变成智能动作**。

## 下一课预告:第九课:Time-traveling stream rules (04 号电池)

- 规则平时不烧 context,模型输出命中正则才注入
- 流中途 abort + 注入 system reminder + 从断点重试
- 规则文件真实格式:`condition` / `astCondition` / `interruptMode`

# Git 历史视图 Graph 化 + 提交 diff 进左侧文件容器

日期:2026-09-04
状态:已确认(当次会话定稿,直接实施)

## 背景与目标

git 插件历史视图当前是「sha + 摘要 + 相对时间」的平铺列表(HistoryView.tsx),无分支拓扑、无 ref 标签、看不到单提交改了哪些文件;提交 diff 只能整仓视角在差异视图里看。

目标(对齐 VS Code Source Control Graph 观感):

1. 历史列表改成 graph 样式:左侧泳道图(彩色圆点 + 连线,VS Code 调色板),行内分支/远端/tag 标签胶囊,「传出的更改 / 传入的更改」标记行(ahead/behind>0 时)。
2. 点击提交行展开该提交的文件清单(文件图标 + 路径 + 状态字母 M/D/A/R…),再点收起。
3. 点击清单中文件,在左侧文件开启容器(编辑器 tab 区,editorCenter.tabContent)打开该提交的 diff tab;tab 内可切换该提交的其他文件。

## 方案取舍

| 决策点 | 选定 | 被否决 |
|---|---|---|
| 拓扑算法 | 纯前端 `computeGitGraph`(从现有 log 分页数据算泳道/连线) | 后端算 graph:分页 append 语义复杂(新页改变已有行颜色),Rust 侧多做一份无消费方的布局 |
| refs 数据 | `git_log` 的 LogEntry 增加 `refs: string[]`(每次 walk 建 oid→refs 映射) | 前端逐提交查:IPC 往返爆炸;复用 git_branches:无法按 sha 反查归属 |
| 提交文件清单/patch | 新增 `git_commit_files` / `git_commit_file_patch` 两个命令(tree↔tree diff,首父提交口径) | 复用 git_diff_file_patch:那是 index/worktree 语义,不覆盖历史提交 |
| 提交 diff 展示 | 编辑器区新 tab kind `git-commit-diff`(同 checkpoints 批审阅单模式) | 塞进右栏面板抽屉:宽度太窄;新面板:切走历史上下文 |
| 文件图标 | 经 `@kernel/fileVisual` 注册点取 SVG(与文件树/tab 栏同源) | git 插件直引 files 插件:破坏插件解耦(内核注册点就是为此设的) |
| 虚拟滚动 | 不引库,保持现有「滚近底自动翻页」+ 50 条/页 | @tanstack/react-virtual:引入新依赖(仓库铁律:不新增库);50 页量级原生渲染无压力 |

## 契约

- `GitLogEntry` 增 `refs: string[]`;装饰形态:`HEAD -> main` / `main` / `origin/main` / `tag: v1`(前端 normalizeRef 兼容全部)。
- `GitCommitFile { path, oldPath?, status, additions, deletions, binary }`;`git_commit_file_patch` 复用 `GitFilePatch`。
- tab:`id = git-commit:<sha>`,kind `git-commit-diff`,payload `{ cwd, sha, shortSha, summary, authorName, authorWhen, focusPath? }`;open 带 `refresh: true`(同一提交重复点文件只换 focus)。
- graph 行:`commit | incoming-changes | outgoing-changes`,合成行 sha 为固定哨兵 id;选中提交展开文件行内联在后续行。
- ahead/behind 沿用现有 `git_ahead_behind`(低频,fetch/刷新后拉),不做新轮询。

## 验证

- Rust:`cargo test`(新增 refs/commit_files/rename/patch 用例)、`cargo clippy -D warnings`、`cargo fmt --check`。
- 前端:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;computeGitGraph 移植用例(线性泳道/合并行/出入标记)。
- 目检:`pnpm tauri:dev` 打开真实窗口,验证 graph 展开、点文件开 tab、tab 内切文件。

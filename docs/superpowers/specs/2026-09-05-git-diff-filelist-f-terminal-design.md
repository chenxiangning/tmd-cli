# Git 差异面板文件列表:F 终端风重构

日期:2026-09-05
状态:已确认(用户批准,原型定稿 `docs/prototypes/git-filelist-F-terminal.html`)

## 背景与目标

右栏 Git 面板的差异视图文件列表(红框区)现状是「勾选框 + 文件图标 + 完整路径 + 状态字母」的通用列表风,信息密度低且与幕布终端气质脱节。定稿原型方案 F 把 git status 的原生语义搬进面板:三段分区、`[x]modified:` 关键字列、右对齐目录列、每文件 ±行数、hover 括号动作、prompt 式提交行。

目标(用户确认范围):

1. 平铺模式的文件列表整体换 F 终端风;树形模式保留现状渲染;
2. 底部提交 composer 换 prompt 式(两布局共享);
3. 每文件 ±行数与 rename 来源路径需要扩 Rust 契约(用户确认);
4. 全部配色走 `--tmd-*` token,明暗/自定义主题零特判自动适配。

面板头部聚合行(分支 / ±总数 / fetch/pull/push)不在范围内,保持不动。

## 方案取舍

**选定:分区由前端从现有 `GitFileStatus` 双轨布尔派生,st 段 [x] 语义 = 已暂存(点击即 unstage)。** 理由:后端 `staged`/`wt` 双轨已完整承载 git status 三区语义(复合文件 staged && wt 在两段各一行,与 git status 原生行为一致),零后端结构变更;提交语义不变 —— `git commit paths` 本就「勾选先 stage 再提交全部 staged」,st 段固定 [x] 如实反映「已暂存 = 必将进入提交」。

**否决:后端改返回三分区结构。** 同一信息两种表达徒增迁移面;且 status 5s 轮询的消费方不止 DiffView(刷新批次、聚合行),分区是渲染层关注点。

**否决:内联 diff 展开(原型的 `fdiff` 段)。** 架构已定案「文件行点击在中央文件区开 git-diff tab」(DiffView 头注释),内联展开是已否决旧路;图 2 截图亦未含内联 diff。

**否决:原型底部键位提示行(s 暂存 / u 取消 / x 放弃)。** 应用内是点击驱动交互,没有这些键位;不渲染假提示。

**numstat 挂 `git_totals` 而非 `git_status`:** totals 本就是「全仓 diff×2」的低频命令(60s 慢巡航 + 写后刷新),两侧 Diff 已在构建,逐 delta 取 `Patch::line_stats` 的成本与 `DiffStats` 聚合同级;5s 轮询的 status 零增重。

## 契约变更(Rust → TS 对应)

1. `FileStatus` 增 `old_path: Option<String>`(serde `oldPath`):rename 时取 `head_to_index` / `index_to_workdir` 的 `old_file` 路径,其余 None。前端目录列显示 `← 旧目录/`。
2. `DiffTotals` 增 `files: Vec<DiffFileTotal>`:`{ path, staged, insertions, deletions }`,staged 标记侧别(tree→index / index→workdir);binary 记 0/0、untracked 整文件计入(与现有聚合口径一致)。
3. `src/kernel/gitContract.ts`:`GitFileStatus.oldPath: string | null`;`GitTotals.files: GitFileTotal[]`。

## 渲染设计

### 三段分区(平铺模式)

| 段 | 派生 | 标题(git status 原文短语) | 段动作 |
|---|---|---|---|
| un | `wt && status ≠ "?"` | `Changes not staged for commit:` | `(全部暂存)` |
| ut | `status = "?"` | `Untracked files:` | — |
| st | `staged` | `Changes to be committed:` | `(全部取消)` |

- 段头:`▾` 折叠(本地 state)+ 标题 + `(N)` + 右侧括号动作;空段显示 `(nothing)`。
- 行(12px mono):`[x]`/`[ ]` 文本勾选框 · 关键字列 86px(`modified:` `new file:` `deleted:` `renamed:` `typechange:` `both modified:`)· 文件名(截断)· 右对齐 rtl 目录列 · `+N −N`。
- 关键字着色沿用 `statusColor.ts` 语义:M=`--tmd-git-modified`、A=`--tmd-diff-inserted`、D/C=`--tmd-diff-removed`、R/T=`--tmd-accent`、ut 关键字空。
- hover:数字位换括号动作 `(暂存)` / `(取消暂存)` / `(放弃)`(危险动作红);un/ut 段勾选 = 纳入提交;st 段 `[x]` 点击 = unstage;冲突行 `—` 禁勾 + 红色 `冲突` 尾注(到幕布解决)。
- 点行开中央 diff tab(现状选侧规则:wt 优先)。

### CommitComposer = prompt 式(两布局共享)

- `commit ▸` 前缀 + 无框底边线输入(textarea 单行起步、随内容长高,保留多行提交能力)。
- `[ ]`/`[x]` amend 文本开关 · `N selected`(st 段路径 ∪ 勾选集)· 右侧 `⏎ commit` 主按钮(`--tmd-accent`)· 错误行内展示。

### 主题适配

原型硬编码色一一定射 token:bg/bg-sunken/bg-hover→`--tmd-bg-*`,fg/muted/faint→`--tmd-fg/-muted/-faint`,border→`--tmd-border`,ins/del→`--tmd-diff-inserted/-removed`,st-m→`--tmd-git-modified`,go 按钮→`--tmd-accent` + `--tmd-accent-fg`。无新增 CSS 变量、无明暗特判。

## 改动面与验证

改动:`src-tauri/src/git/{status,diff,commands}.rs` + 测试、`src/kernel/gitContract.ts`、`src/plugins/git/views/DiffView.tsx`(重写平铺渲染 + composer)、`src/plugins/git/GitPanel.tsx`(传 numstat)。

不动:GitToolbar / panelStore(树形保留)、`diffTree.ts`、中央 diff tab、头部聚合行。

验证:`cargo test && cargo clippy --all-targets -- -D warnings && cargo fmt --check`;`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;`pnpm tauri:dev` 明暗两主题目检分区/勾选/hover 动作/提交全链路。

# 16 — Worktree 关联管理契约(仓 → 树 → 分支 → 侧栏)

- 日期:2026-09-27(沉淀 2026-09-26 ea1e77c..b55c404 + 评审收口 94e513e)
- 状态:生效中
- 上游:spec `docs/superpowers/specs/2026-09-26-worktree-assoc-management-design.md`(A 侧栏归簇 + B Git 面板分区,并做);提案 `openspec/changes/archive/2026-09-26-worktree-orchestration/`

## 结论

worktree 不再是「三张皮」(侧栏平铺卡 / 分支列表混业务分支 / 管理藏弹窗):Rust 提供四条 shell-out 命令,展示面三处联动 —— Git 面板常驻「工作树」区 + 分支按检出归属三分区 + 侧栏同仓卡归簇共框。全程零新增业务 IPC 语义、PTY 幕布零触碰。

## 契约

### Rust 命令面(`src-tauri/src/git/commands_worktree.rs` + `worktree_parse.rs`)

| 命令 | 口径 |
|---|---|
| `git_worktree_list` | shell-out `git worktree list --porcelain`(libgit2 worktree 支持残缺:锁/prune 语义不全,CLI 是唯一全功能面)。porcelain 解析在 `worktree_parse.rs` 纯函数(单测覆盖);**路径回贴**:git 输出 canonical 路径,按输入 cwd 前缀回贴(3774a67:symlink 双路经如 /tmp↔/private/tmp 否则前端字符串比较误判)。主仓恒首条(git 契约)。 |
| `git_worktree_add` | `-b` 新建(基于当前 HEAD)或检出已有分支。分支名闸:空/前导 `-`(防 argv 注入,non_empty_branch 同款);path 同闸。**预检 `ensure_branch_free`**:show-ref 命中 = 可行动指引(「可关闭新建分支直接检出它」),`Err(Shell(_))` = 不存在放行,其余(启动失败/超时)上抛不折叠。**校验与执行同源**:trim 后串一份真相入 argv。new_branch=true 成功后 `addWorkspace(path)` 联动进侧栏。 |
| `git_worktree_remove` / `git_worktree_prune` | git 自校验兜底(未提交内容拒绝,force 才强拆)。 |

**写命令纪律(CI 可查的教训)**:worktree add/remove/prune 改变 .git 目录(refs/工作树登记),必须走 `run_mut` —— 成功后 evict 缓存 Repository;走只读 `run` 则 bumpGitRefresh 后 `git_branches` 复用陈旧句柄,新建分支不可见(94e513e 评审 P1)。凡外部 CLI 写操作一律 run_mut,先例 merge/rebase/rename。

### 命名与清理口径(前端 `src/plugins/git/worktree/dirName.ts`)

- 新建分支统一 `wt/` 前缀(`branchForWorktree`:裸名才加;自带命名空间如 `feature/x` 或已带前缀原样透传)—— tmd 建的并行树一眼可辨,不与业务分支撞名。
- 目录名 = `dirNameFromBranch`(非法字符→`-`,压缩与去尾),`validateDirName` 返回串即 i18n 词典键(F8 注释锚)。
- 路径拼接恒 `主仓父目录/目录名`(`worktreePathFor`,不收用户手输路径;盘根仓库拒绝,防 worktree 嵌进主仓);Windows 输出混用分隔符是有意口径(git/OS 接受,比较面全走 normalizeRoot,测试已钉,勿顺手改)。
- 移除 = 对称清理(`worktreeOps.removeWorktreeWithCleanup`,两处 UI 共用唯一实现,弹窗不得复制):worktree remove → 同 root 工作区摘除(normalizeRoot 比较)→ 分支尾巴安全删(`-d` 语义;未合并被 git 拒 = 保留并在 notice 说明;被其他树检出 = 跳过,动它会弄残那棵树)。

### Git 面板展示面(git 插件)

- **WorktreeZone**(常驻区,GitPanelMain 顶部):多树仓才出现(单树 return null);三态卡 = 主仓/当前/悬空(prunable);动作 = 打开为工作区 / 在此树开终端(复用「打开为工作区」+ `host.createShellSession`)/ 移除(两段确认,走共享清理层);脏净徽章每树懒加载 `git_status`。拉取带 reqRef token 防切仓竞速;移除成功 `bumpGitRefresh()` + 本地重拉。
- **分支三分区**(`worktreeBranchGroups.ts` 纯函数 + `useWorktreeBranchGroups`):主仓检出 / 检出于某树(按树子组,标注当前)/ 未检出(行尾「建树」→ panelStore 桥预填弹窗检出已有分支模式)。`zoned=false`(非仓/命令失败/单树仓)回退平铺 = 零 UI 变更红线。归属数据面订阅 refreshNonce(弹窗/常驻区增删后不重拉会残留已删树空组头)。检出中分支行 `deletable=false`(git 必拒删,不给必然失败的按钮)。
- **WorktreeManageDialog**:降级为「+ 新建」入口 + 移除/清理面;浮层壳 = portal + `role=presentation` 自捕遮罩 + `z-[1201]` + window Esc(SearchOverlay/RelayDialog 同纪律);增删清后一律 `bumpGitRefresh()`。
- **在途合并**:`worktreeOps.listWorktrees` 并 cwd 级并发请求(常驻区与分支归属面同刻双挂载只 spawn 一次 git;不做 TTL,新鲜度优先)。

### 侧栏归簇(workspace 插件 `useWorktreeCluster.ts`)

- 每卡 root 懒加载 `git_worktree_list`,主仓锚 = entries[0].path;同锚卡归一簇 = 主仓卡在前 + worktree 卡平级跟随,`.ws-worktree-cluster` 上下虚线框归组(二次修订:弃缩进与卡上徽章,悬空/脏净展示面收进 WorktreeZone),worktree 卡图标 GitFork。
- 模块缓存 60s TTL,probe 失败 10s 负缓存(否则 store 每次 emit 对非仓目录重起 git);在途合并。
- **P0 纪律**(2026-09-26 真机卡死事故):调用方 roots 必须 useMemo 钉住引用;hook 内 setState 一律等值兜底(同引用返回 prev)—— 两者缺一即渲染循环。
- 渲染守卫:`clusterBuckets` main 槽先到先得,同 root 重复卡(addWorkspace 零判重可达)落 children 不吞渲染(评审 P1);孤 worktree(主仓不在本组)平铺不框。
- 已知限制:同仓判定 = normalizeRoot 字符串相等,symlink 双路经/盘符大小写变体不聚簇(接受,不为此加 canonical 化复杂度)。

### 术语与词典

- 簇 label 裸文本 `worktree` 三语同形,不做 i18n 键(WorkspaceList 注释锚)。
- git 域 en/ja 键与 zh 源串一一对应;撤除的展示面必须顺手删净键(2026-09-27 评审清 5×2 死键)。

## 验证

- 纯函数单测:`worktree_parse`(porcelain 解析/回贴)、`worktreeBranchGroups`(归属三分区/归属唯一性)、`dirName`(前缀/校验/拼路径)、`useWorktreeCluster.test`(归桶/孤桶/重复卡不吞)。
- Rust 单测:ensure_branch_free 指引与放行(TempRepo);写命令 evict 走 run_mut 纪律。
- 门禁:typecheck / vitest / check:arch-boundary / check:file-size / build / react-doctor 100 / cargo test+clippy+fmt。
- UI 行为:1421 桩实证已做;真机目检(侧栏同仓共框归组、工作树区三态卡、分支三分区、「建树」预填)待大仙。

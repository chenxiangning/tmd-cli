# worktree 关联管理:侧栏分层 + Git 面板分区(方案 A+B 并做)

- 日期:2026-09-26
- 状态:已落地(A+B 并做;B 的 Git 面板区/分支三分区与 A 的侧栏归簇均经 1421 桩实证,真机目检待大仙)
- 原型:`docs/design/worktree-nested-sidebar.html`(A)/ `docs/design/worktree-git-panel-zone.html`(B)
- 背景:worktree 与工作区、分支当前是三张皮 —— 侧栏工作区平铺、分支列表 worktree 分支混在业务分支里、管理藏在弹窗。本设计打通「仓 → 树 → 分支 → 会话」的关联展示,不改任何数据写入路径。

## 背景与目标

1. 同一仓库的多个 worktree 在侧栏有从属可视化(方案 A),不再散落平铺。
2. Git 面板有常驻「工作树」分区,分支列表按检出归属归组(方案 B),worktree 管理从弹窗升级为一等分区。
3. 全程零新增 IPC、零 Rust 行为变更(`git_worktree_list` / `git_worktree_add` / `git_worktree_remove` / `git_delete_branch` 既有面);PTY 幕布与 CLI 私有格式零触碰。

## 方案取舍

| 决策 | 选定 | 否决与理由 |
|---|---|---|
| 侧栏从属表达 | 组内归簇渲染:主仓卡在前,worktree 卡缩进跟随(视觉从属,卡片本体不 replaced) | 把 worktree 卡替换成紧凑行(原型 A 的行式):侧栏卡是会话浏览面,行式会砍掉会话列表,破坏既有交互 |
| 归簇数据来源 | 对每张卡 root 懒加载 `git_worktree_list`,主仓锚 = entries[0](git 恒主仓首条),模块级缓存 | 全量 BFS 扫仓或改 repos_scan:越权且重;每次渲染全跑 git:卡顿 |
| 脏净点数据 | 每树懒加载 `git_status`,与归簇同缓存节奏 | 轮询全树:无谓 git spawn 风暴 |
| 会话徽章 | host.getSessions() 按 cwd 归并,内存零成本 | 新查询通道:重复造面 |
| B 的工作树区位置 | GitPanelMain 顶部常驻区,弹窗降级为「+ 新建」入口 | 保留弹窗为唯一面:管理仍藏一层;替换弹窗:破坏 WorktreeManageDialog 既有新建/清理流 |
| 分支归组 | 本地分支三分区:主仓检出 / 检出于某树(按树子组)/ 未检出(行尾「建树」入口) | 平铺 + 徽章标注:关联感弱;远程组不动(无 worktree 概念) |
| 工作树卡动作 | 第一版:打开(切工作区)/ 终端(新会话到该 cwd)/ 移除(既有安全删链路) | 合并回主仓/同步:涉及目标分支选择与冲突中间态 UI,二期 |
| 跨插件 | workspace 插件直接走 `@kernel/ipc` 的 git_worktree_* 命令,不经 git 插件模块 | import git 插件模块:跨插件耦合;kernel 下沉:单插件语义不入 kernel |

## 实现面

- git 插件(方案 B):`WorktreeZone.tsx`(工作树区,新文件)/ `GitPanelMain` 接线 / `BranchView` 本地组按归属三分区 / 归组纯函数 `worktreeBranchGroups.ts` + 单测 / 未检出行「建树」入口预填 WorktreeManageDialog(检出已有分支模式)。
- workspace 插件(方案 A):`useWorktreeCluster.ts`(懒加载归簇 hook + 模块缓存)/ `WorkspaceList` 归簇渲染。二次修订(d1a85ad/5256817,真机卡死与视觉二审后):弃「主仓卡头 N 棵树 + 缩进连线」与 WorkspaceCard 徽章(分支/脏净/会话数/悬空),改为同簇卡平级共框虚线归组 + worktree 卡 GitFork 图标;悬空/脏净展示面收进 Git 面板 WorktreeZone。归簇懒加载 probe 失败有 10s 负缓存。
- 词典:en/ja git 域 + workspace 域新键;zh 恒等。

## 验证

- 归组/归簇纯函数单测(归属分区、悬空判定、主仓锚)。
- 门禁:typecheck / vitest / check:arch-boundary / check:file-size / build / react-doctor 100。
- UI 行为变更:tauri:dev 真机目检 —— 侧栏同仓两卡共框归组、Git 面板工作树区三态卡、分支三分区、「建树」预填;测试绿不算数。

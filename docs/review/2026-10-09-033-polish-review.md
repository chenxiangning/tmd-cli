# 0.3.3 近期内容整体打磨评审

日期:2026-10-09
状态:已收口(6 项全修,门禁全绿 + 桩目检实证)

## 范围

v0.3.2..v0.3.3 六个功能提交(git 聚合模式 47b1033d / 历史行图标 02dc8dba / 工作区双菜单 6e9f06c5+288605f8+22534a9f)加发版后两个提交(有界并发 54769b02 / checkpoints 图标 bb598644)。

## 复核结论(逐项先证伪再动手)

- locale 键全在册:「目标远端分支」「选中提交详情」「拉取」「推送」等新键落在 git2.ts / workspace.ts / wsl.ts,en/ja 双语齐;被重构删除的键(工作区来源/选择目录…)已同步清。
- CSS 无孤儿:`wsmenu-item-row` 仍被 welcome/VersionMenu 消费;workspace-add.css 全类有主;workspace-menu.css 迁出 wsadd-* 后无残留。
- `wsmenu-item-row`→`wsmenu-cell`、`.is-danger` 悬停淡红、⟳ 角标 opacity 降噪(含 `(hover:none)` 触摸常显)复核通过,不改。
- 54769b02 有界并发复核通过:mapPool 单线程 cursor 无竞态、fn 异常执行器自捕获、取消语义(在途跑完/未起标取消)文档化一致。
- bb598644 checkpoints 图标复核通过:行根有 `group`,按钮自带 `hidden group-hover:grid`,hover 语义正确。

## 已修(6 项)

1. **历史行打开图标常显**(02dc8dba 回归):HistoryRow FileRow 行根无 `group`、FileOpenActions 无包装,两个图标恒显——注释声称「hover 出现」,DiffView 侧实装是 `opacity-0 group-hover:opacity-60` 常占位包装。修:行根加 `group`,图标裹同款 opacity 包装(常占位零位移)。
2. **doctor.config.json 死豁免**:useBatchGitOps 的 `async-await-in-loop` 豁免在 54769b02 改 mapPool 后无循环可豁免;删除后 react-doctor 仍 100,实证死配置。
3. **useGitPanelContext 死返回**:`active` 无消费者(GitPanel 未解构),删。
4. **HistoryRowItemProps.cwd 可选**:`?? ""` 兜底会拼出 `/相对路径` 坏路径且静默;唯一调用方 HistoryView 恒传,收紧为必传。
5. **RowStatus 类型放宽**:`phase: string` 丢 RowPhase 联合约束,收紧为 RowResult。
6. **FileOpenActions 重复计算**:onClick 重算 worktreeAbsPath(abs 已在手),复用。

## 留观(不动)

- WorkspaceAddDialog 的 `ActiveTab && activeOrigin` 守卫与两处 `addTab!` 并存:2026-10-08 评审已裁「纯风格留」,不翻案。
- git/checkpoints 两插件各持一份打开图标按钮:跨插件 UI 呈现非契约,不升 kernel;漂移再议。

## 验证

- 门禁:`pnpm typecheck && pnpm test`(484 文件 3781 例)`&& pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `npx react-doctor@latest -y`(无问题)。
- 桩目检(1421 + Tauri IPC 桩,git_log/git_commit_files 假数据):历史视图展开提交,M 行图标 2 枚(打开文件/打开文件位置)、hover 前计算样式 opacity=0、hover 后 0.6;D 行槽位在、图标 0(盘上已删不渲染)。

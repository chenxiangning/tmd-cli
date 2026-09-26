# 文档全量对码 v0.2.4(2026-09-27)

- 日期:2026-09-27
- 状态:已完成
- 范围:docs/architecture/*、docs/FEATURES.md、docs/README.md、README.md、README_EN.md、openspec/changes 归档收口
- 方法:自 09-19 上次全量对码(9d94c8b 谱系)以来 320 个提交逐域扫描,全部口径以代码实数为准(allPlugins / generate_handler / MountPoint union / IPC_METHOD_GRANTS / git log)

## 基线实数(机械扫描取证)

| 口径 | 旧文档 | 实况 |
|---|---|---|
| allPlugins 注册插件 | 32(09-19 口径) | 38:engine 10 / feature 24 / core 3 / local 1 |
| MountPoint 挂点 | 14 | 15(补 composer.attachments) |
| Tauri command 注册 | 116 | 151:git 40 / ssh 19 / web·relay 15 / session_commands 12 / checkpoints 11 / commands_fs 16 / fs_edit 7 / wsl 6 / plugins_cmds 5 / open_with 3 / lsp 3 / quota 2 / sqlite 2 / lib.rs 直注册 10 |
| IPC_METHOD_GRANTS 条目 | 114 | 130 |
| PluginContext 注册面 | 14 个 register* | 19 个(补 editorExtensions / terminalLinks / languageServer / academyCourse / cliConfig) |
| ctx overlay 贡献方 | settings / network-proxy / ssh 三插件 | 十一插件(见 02 §10) |
| 版本号 | v0.1.7(02 头) | v0.2.4(package.json 0.2.3 为 HEAD 期实值,tauri.conf 同步;CHANGELOG 已发 0.2.4) |

## 逐档修订

- **01-overview**:头部校准戳;产品边界表重写(右缘 rail / 左栏搜索·学堂入口 / worktree 归簇);§2 分层清单补 academy / notify / session-search / session-relay / approval-inbox / prompt-enhancer / session-budget 等与 Rust 新模块(web / lsp / open_with / worktree_parse / app_setup panic 钩子);§6 挂点 14→15 与注册面全表;§8 状态段整体重写至 v0.2.4,在途口径改实。
- **02-code-architecture**:v0.1.7→v0.2.4;SHELLX 补 PanelRail;PLUGINS 子图补 11 个新插件节点;BE 子图补 WEB/LSP/OW 节点与 edges(含中继服务器/语言服务器外部节点、两棵 UI 树动态分流注);§3 PTY 数据流退出码契约注记(portable-pty 语义:0/信号归一 1/用户 kill 与 SSH = null);依赖铁律补 ctx 全清单与 mobile 树纪律;§6 挂载点地图 15 点 + 新贡献边 + PanelRail 注;§7 模块图插件行补全;§8 命令面 116→151 与 worktree/lsp/open_with/web/session 新行;§9 react-doctor 876 源文件口径;§10 已知缺口刷新(overlay 贡献方、mobile M2 真机验收)。
- **03-shortcuts**:键位表补插件贡献面(search ⇧⌘F/⌘P、session-search ⌘O、其余无默认键)。
- **06-disk-first**:契约段补「异常退出」条目 —— 退出码语义、sessionExitedDetail 双事件、消费闸 null/0/130 不上卡、notify 失焦档。
- **08-session-lifecycle**:闸 4c readopt 行补 per-profile busyHoldMs 随重锚落位(8169e48)。
- **12-web-remote-access**:新增「中继部署历史与凭据口径增补」节(Rust persist_selfhost 落盘、含口令明文纪律、私钥只存路径、sanitize 双边一致、断管道免疫、截图注入、copyText 收口)+「已知取舍」(09-15 提案任务板 0/30 = 记账欠账,状态以本文与代码为准)。
- **14-lsp-semantic-nav**:内核原语行补 stderr 纯排空收口(b3d3eff)。
- **07-plugin-hardening**:grants 114→130。
- **16-worktree-contract(新)**:沉淀 worktree 全链路契约 —— Rust 写命令 run_mut/evict 纪律、ensure_branch_free 分类、wt/ 前缀与安全清尾、dirName 口径(Windows 混分隔符锚)、WorktreeZone/三分区/侧栏归簇三展示面、P0 渲染循环纪律、main 槽先到先得、在途合并、已知限制与验证面。docs/README 登记。
- **docs/FEATURES.md**:09-27 全量补校头;工作区会话域补搜索折叠入口/学堂/卫生清扫;Composer 域补接力与增强提示词;审批线域补收件箱;Git 面板域重写 worktree 四条;文件与编辑器域补搜索面板;外壳域重写顶栏三区 + 右缘 rail;插件市场计数 32→38。
- **README.md / README_EN.md**:「当前状态」段补 0.2.x 全部增量域与在途清单;架构分层图补 mobile 树与 web/lsp 模块;README_EN 落后最狠(计数停留 26/31、缺 academy/worktree/notify 等全部 0.2.x bullet)→ 与中文版逐域对齐补写;插件市场行 34/26→38 口径统一。

## openspec 收口

已落地并登记完毕的十案移入 `openspec/changes/archive/`:2026-09-15-web-remote-access(能力先于任务板落地)、2026-09-25-approval-inbox、2026-09-26-{approval-risk-tier, exit-toast-resume, mobile-shot-inject, os-notifications, session-relay, session-search, session-usage, worktree-orchestration}。全仓引用路径同步 repoint(docs/README / research / architecture 12·16 / review / specs)。仍开放:mobile-app-m2(状态行改实:代码已落地、真机验收余 8 项)、signing-pipeline(部分落地)、composer-command-drawer(真机验收在途)。

## 验证

纯文档轮:全部计数经机械扫描取证(非记忆);`pnpm check:file-size`(markdown 不受 300 行闸约束)、react-doctor 100 复跑;archive 移动经 git mv 保历史;引用路径 grep 复验零残留。

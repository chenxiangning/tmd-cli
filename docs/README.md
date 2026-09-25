# tmd-cli 文档中心

> 项目规划与设计文档库。所有与 AI 的规划交互均落盘于此。
> AI 产出的落盘去处、命名与登记义务以根目录 `AGENTS.md` §0「文档落盘铁律」为准,下表是其展开;新文档不登记到索引视为未落盘。

## 目录结构

| 目录 | 用途 | 写入时机 |
|---|---|---|
| `brainstorm/` | 需求澄清对话记录（按日期归档） | 每次规划对话后追加 |
| `research/` | 调研与学习材料（mossx/codemoss 盘点 · CLI 能力矩阵 · omp CLI 课程） | 调研完成时 |
| `design/` | 交互设计原型 html（浏览器可打开） | 设计探索时 |
| `prototypes/` | 设计文档配套 UI 原型 html | 设计定稿前 |
| `review/` | 评审记录（架构 / 平台 / 冗余等） | 评审完成后 |
| `superpowers/` | superpowers 流程产出的正式设计 spec | 需求收敛后 |
| `architecture/` | 已落地的系统架构与契约 | 基础设施或架构调整后 |
| `images/` | README 配图等静态图片资产 | README 引用新图时 |

## 文档索引

| 日期 | 文档 | 状态 |
|---|---|---|
| 2026-09-01 | [项目启动：为什么另起炉灶](brainstorm/2026-09-01-kickoff.md) | 进行中 |
| 2026-09-01 | [mossx 对话框能力盘点](research/mossx-composer-capabilities.md) | 已完成 |
| 2026-09-01 | [mossx Git 能力盘点](research/mossx-git-capabilities.md) | 已完成 |
| 2026-09-06 | [类似客户端产品盘点(GitHub,12 家公开项目 + 4 家闭源背景)](research/similar-products.md) | 已完成 |
| 2026-09-01 | [omp CLI 学习笔记(14 课主课 + prompts/ 用户速查)](research/omp-cli-course/README.md) | 已完结 |
| 2026-09-13 | [omp 打开历史会话性能分析与常驻预热方案研究](research/omp-session-open-performance.md) | 已完成(方案已落地:预热接管,契约见 architecture/10) |
| 2026-09-03 | [omp 最近版本升级记录(v18.0.7-18.1.6)](research/omp-cli-course/releases.md) | 持续更新 |
| 2026-09-01 | [基础架构总览](architecture/01-overview.md) | 已落地(09-14 校准:27 插件 / 挂点 14 / WSL / 壁纸 / 自动更新 / 预热秒开;09-19 校准:31 插件) |
| 2026-09-01 | [代码级架构（Mermaid）](architecture/02-code-architecture.md) | 对齐当前代码(09-07 校准:删除意图 tombstone/会话删除顺序/归档容量与分页/dsh 删除与空壳契约;**09-10 校准**:dsh 5.2 改以 0.1.2 斜杠方法面 + /api/remote.mux 双流实测契约,补 react-doctor 治理原则 9 表;**09-14 校准**:v0.1.7 对码 —— 命令面 116 / 插件 27 / 挂点 14 / acquireResume 接管流程图 / pull rebase 兜底 / wsl 与本机插件命令行;**09-19 校准**:插件 31,新增 marks/search 插件与编辑器扩展/终端链接两条宿主注册表,契约见 architecture/13) |
| 2026-09-01 | [Composer 工具栏设计](superpowers/specs/2026-09-01-composer-toolbar-design.md) | 已确认 |
| 2026-09-01 | [Composer 富输入框设计原型](design/composer-design.html) | 已落地 |
| 2026-09-01~02 | [UI 原型:composer 工具栏 / 欢迎页额度 / 设置面板 / 消息锚点栏 / git 文件列表 ×3 / 批审阅面板 / 插排](prototypes/) | 设计定稿配套 |
| 2026-09-02 | [Composer 命令抽屉交互原型](design/composer-drawer-demo.html) | 已落地 |
| 2026-09-02 | [会话列表展示探索 v1 / v2](design/session-list-showcase.html) | 设计原型 |
| 2026-09-02 | [checkpoints 批次审批设计](superpowers/specs/2026-09-02-checkpoints-batch-review-design.md) | 已落地(09-05 隔离与手术增量,见 09-05 spec) |
| 2026-09-02 | [插件市场（插排）设计](superpowers/specs/2026-09-02-plugin-market-strip-design.md) | 已确认 |
| 2026-09-02 | [架构与插件化合规评审](review/2026-09-02-architecture.md) | 已完成 |
| 2026-09-02 | [跨平台兼容性评审](review/2026-09-02-platform.md) | 已完成 |
| 2026-09-02 | [冗余与死代码评审](review/2026-09-02-redundancy.md) | 已完成(09-03 复核处置,见文末) |
| 2026-09-02 | [每日评审](review/2026-09-02-daily-review.md) | 已完成 |
| 2026-09-03 | [插排徽标升级设计](superpowers/specs/2026-09-03-plugin-market-icons-design.md) | 已评审通过 |
| 2026-09-03 | [会话标题 tab 条设计](superpowers/specs/2026-09-03-session-title-tabs-design.md) | 已落地 |
| 2026-09-03 | [父子会话层级原型:方案 B 定稿(父节点即开关,保留 FLUX 时间轴)](design/session-hierarchy-schemes.html) | 设计原型 |
| 常态 | [功能清单 FEATURES](FEATURES.md) | 随代码演进(09-19 补校:文件标记 / 全文搜索与快开 / md 快路径 / git 面板工具条 / 状态巡航尺寸闸,插件 31) |
| 2026-09-04 | [Git 历史视图 Graph 化 + 提交 diff 进左侧文件容器](superpowers/specs/2026-09-04-git-history-graph-design.md) | 已落地 |
| 2026-09-04 | [文件渲染档案:补齐 codemoss 全量文件预览形态](superpowers/specs/2026-09-04-file-render-profiles-design.md) | 已落地 |
| 2026-09-04 | [SSH 模块竞品调研](research/ssh-module-reference.md) | 已完成 |
| 2026-09-04 | [SSH 插件需求澄清(竞品调研)](brainstorm/2026-09-04-ssh-plugin.md) | 已收敛 |
| 2026-09-04 | [SSH 插件设计:一等会话 + 右栏 SFTP 树 + 端口转发](superpowers/specs/2026-09-04-ssh-plugin-design.md) | 已落地(引擎端到端实测,提案归档 openspec/changes/archive/2026-09-04-ssh-plugin/) |
| 2026-09-04 | [文件 tab 右键菜单 + 编辑区最大化切换设计](superpowers/specs/2026-09-04-tab-menu-editor-maximize-design.md) | 已落地 |
| 2026-09-04 | [插件边界审计 + 死代码清理](review/2026-09-04-boundary-deadcode-cleanup.md) | 已完成(diskSessions 下沉 cli-shared / 面板 subbar 注册化 / edits 骨架收敛 / 88 处导出降级) |
| 2026-09-04 | [Composer 触发器补全重构:以 CLI 为真相源(需求澄清)](brainstorm/2026-09-04-composer-cli-sourced-suggestions.md) | 已收敛 |
| 2026-09-04 | [Composer 触发器补全重构:`/` `$` `@` 以 CLI 为真相源](superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md) | 已落地 |
| 2026-09-04 | [Diff 视图噪音清理:hunk 分隔条](superpowers/specs/2026-09-04-diff-noise-cleanup-design.md) | 已落地 |
| 2026-09-05 | [Git 差异面板文件列表:F 终端风重构](superpowers/specs/2026-09-05-git-diff-filelist-f-terminal-design.md) | 已确认 |
| 2026-09-05 | [Git 远端操作对话框复刻(codemoss push/pull/fetch)+ 顶栏聚合数字迁移](superpowers/specs/2026-09-05-git-remote-dialogs-design.md) | 已落地 |
| 2026-09-05 | [分支右键菜单对齐 codemoss:变基/合并/对比/重命名/自指定分支新建](superpowers/specs/2026-09-05-branch-menu-parity-design.md) | 已落地 |
| 2026-09-21 | [增强提示词(composer 增强入口)设计](superpowers/specs/2026-09-21-prompt-enhancer-design.md) | 已确认 |
| 2026-09-25 | [手机 app 与桌面客户端样式/词典分家设计](superpowers/specs/2026-09-25-mobile-client-style-split-design.md) | 已落地 |
| 2026-09-25 | [Android 壳与移动端发布集成设计](superpowers/specs/2026-09-25-android-shell-and-mobile-release-design.md) | 已落地 |
| 2026-09-05 | [会话 tab 右键菜单:重命名 + 关闭一套](superpowers/specs/2026-09-05-session-tab-context-menu-design.md) | 已落地 |
| 2026-09-05 | [会话状态标签:结算归因修正 + SIGWINCH 重绘抑制窗](superpowers/specs/2026-09-05-session-status-settle-attribution-design.md) | 已落地 |
| 2026-09-05 | [审批线隔离与精准手术:纯事件归因 · 批审计冻结 · 共改文件 diff 擦除](superpowers/specs/2026-09-05-checkpoints-isolation-surgery-design.md) | 已落地 |
| 2026-09-05 | [插件化架构审查与插座化重构(评审记录)](review/2026-09-05-plugin-socket-refactor.md) | 已落地 |
| 2026-09-05 | [8 引擎 Memory 治理集成设计 —— Magic Context 走法 B](research/magic-context-8-engine-integration.md) | 已被 spec 取代(保留作调研底稿) |
| 2026-09-05 | [8 引擎 Memory 集成设计评审(走法 B 首稿)](review/2026-09-05-memory-integration-design-review.md) | 已完成(不通过,退回修订) |
| 2026-09-05 | [Memory Coordinator 设计:Magic Context 记忆池 + 双通路注入(8 引擎)](superpowers/specs/2026-09-05-memory-coordinator-design.md) | 已落地(§8 UI 定稿并入;实施契约归档 openspec/changes/archive/2026-09-05-memory-coordinator/) |
| 2026-09-05 | [Memory 胶囊最终效果原型(tmd-cli 客户端还原)](design/memory-capsule-demo.html) | 已定稿(随 spec 批准,headless 实测通过) |
| 2026-09-05 | [opencode CLI 插件化接入设计](superpowers/specs/2026-09-05-opencode-cli-plugin-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-05 | [opencode 插件接入评审(复活绑定 / edits 水位 / MCP 分区 / 命令优先级)](review/2026-09-05-opencode-plugin-review.md) | 已完成(修复随评审提交) |
| 2026-09-05 | [Magic Context PoC 实测报告(安装/schema/计划外发现)](research/magic-context-poc-report.md) | 持续更新(PoC-1/2/5/7 通过;PoC-7 修订 d 路决策) |
| 2026-09-05 | [应用内全局快捷键系统:kernel 命令注册表 + 插件贡献键位](superpowers/specs/2026-09-05-shortcuts-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-06 | [内置终端:terminal 插件(SSH 一等会话同构)+ 头部左区入口](superpowers/specs/2026-09-06-terminal-plugin-design.md) | 已落地 |
| 2026-09-06 | [快捷键系统架构契约:kernel 命令注册表](architecture/03-shortcuts.md) | 已落地 |
| 2026-09-06 | [版本号点击弹窗:更新记录 + 在线更新检查](superpowers/specs/2026-09-06-update-check-changelog-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-06 | [发版前代码评审(死代码/P1 缺陷/P2 修复)](review/2026-09-06-prerelease-code-review.md) | 已落地(修复全绿,缓修 4 项见文末) |
| 2026-09-06 | [d 路修订评审:subagent 入口传 flag 才能让 ctx_memory 工具注册](review/2026-09-06-d-path-flag-fix.md) | 通过(d 路 v2 落地在 §8 续项;依据 PoC-7 二次实证) |
| 2026-09-06 | [左侧工作区会话分类折叠(CLI/终端/SSH 段头开关 + 折叠计数 + settings 持久化)](superpowers/specs/2026-09-06-workspace-group-collapse-design.md) | 已被 09-08 扁平化取代(段头/折叠退役) |
| 2026-09-06 | [omp 扩展市场:cli-omp 二级插件安装/卸载](superpowers/specs/2026-09-06-omp-extension-market-design.md) | 已落地(实现随本次提交) |
| 2026-09-06 | [快捷键终端聚焦期放开:global 不再静默 + Ctrl+Tab 死键位修复](superpowers/specs/2026-09-06-shortcuts-terminal-focus-design.md) | 已落地 |
| 2026-09-06 | [协作模式管线原型(collaboration-mode-prototype;其余探索稿已随 0.1.2 清理删除)](design/collaboration-mode-prototype.html) | 设计原型 |
| 2026-09-06 | [Windows 平台适配契约(ConPTY 握手 / 会话 slug / 子进程收尸 / cargo test)](architecture/04-windows-platform-contract.md) | 已落地 |
| 2026-09-06 | [会话管理模式 + 归档视图(段头开关 / 拖选多选 / 批量归档删除 / 归 徽记)](superpowers/specs/2026-09-06-session-manage-archive-design.md) | 已落地(09-07 修订:归档容量逐出 / 删除顺序 / 归档视图独立分页) |
| 2026-09-07 | [Git 多仓支持调研(断点矩阵 / 桌面客户端共识 / 方案否决依据)](research/git-multi-repo.md) | 调研底稿 |
| 2026-09-07 | [Git 多仓支持 v2 原型(浅色复刻基准:RepoBar / 引导 / 骨架 / toast)](prototypes/git-multi-repo-v2.html) | 定稿原型 |
| 2026-09-07 | [Git 多仓支持设计:workspace 多仓库发现与仓上下文切换](superpowers/specs/2026-09-07-git-multi-repo-design.md) | 已落地(Rust 扫描原语 + GitPanel 分档 + 跨仓着色;桩目检四场景通过) |
| 2026-09-06 | [编辑 tab 条上移顶栏:与会话 tab 合并一行(双激活并存)](superpowers/specs/2026-09-06-editor-tabs-into-titlebar-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-06 | [cli-dsh 插件设计:第十个 CLI 引擎(DeepSeek Harness 安装/启动引导)](superpowers/specs/2026-09-06-cli-dsh-integration-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-07 | [cli-dsh 会话接入:PTY 适配器方案(host-RPC 第二客户端)](superpowers/specs/2026-09-07-cli-dsh-pty-adapter-design.md) | 已落地(真 host 端到端 + 桩目检通过) |
| 2026-09-07 | [侧栏会话分区:已置顶/运行区/工作区分组契约](architecture/05-sidebar-session-zones.md) | 已落地 |
| 2026-09-09 | [磁盘先行回放:会话打开零预付进程](architecture/06-disk-first-session-open.md) | 已落地 |
| 2026-09-07 | [CLI 触发符与会话恢复机制矩阵(omp/pi/codex 实测)](research/cli-trigger-and-session-matrix.md) | 已完成 |
| 2026-09-07 | [设置外观四件套:i18n / 终端字体字号 / 界面缩放 / 终端 ANSI 配色](superpowers/specs/2026-09-07-appearance-i18n-terminal-theme-design.md) | 已落地(全量文案迁移 + 浏览器桩目检通过) |
| 2026-09-08 | [全局界面字号:文字级缩放适配所有模块](superpowers/specs/2026-09-08-global-ui-font-size-design.md) | 已落地(全库 px→rem 等值迁移 + 桩目检通过) |
| 2026-09-08 | [Git 文件 diff 单栏/双栏视图设计](superpowers/specs/2026-09-08-git-diff-split-view-design.md) | 已落地(双栏配对 + 全文查看,全链验证绿) |
| 2026-09-08 | [会话时间线(审批线面板「时间线」页签)设计](superpowers/specs/2026-09-08-session-timeline-design.md) | 已落地(桩目检通过) |
| 2026-09-08 | [会话时间线原型 方案 A:审批线面板页内 tab](design/session-timeline-scheme-a.html) | 设计定稿(扁平化后与落地一致) |
| 2026-09-08 | [会话时间线原型 方案 B:独立面板 + 工作区作用域](design/session-timeline-scheme-b.html) | 设计原型(二期候选) |
| 2026-09-08 | [图标装饰设置:7 个界面图标的独立颜色与呼吸闪烁](superpowers/specs/2026-09-08-icon-decor-design.md) | 已确认(实现随本 spec 提交) |
| 2026-09-08 | [会话状态机:轮次开启闸(关 tab 噪音不误标未读,在途任务照标)](superpowers/specs/2026-09-08-turn-start-gate-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-08 | [工作区会话列表视觉重构探索:扁平时间序 / 时间分桶](design/workspace-sessions-flat-visual.html) | 方案 A 已定稿(见同日 spec) |
| 2026-09-08 | [工作区会话列表扁平化视觉重构设计](superpowers/specs/2026-09-08-workspace-sessions-flat-design.md) | 已确认(实现随本 spec 提交) |
| 2026-09-08 | [启动自动激活最近会话设计](superpowers/specs/2026-09-08-auto-activate-recent-sessions-design.md) | 已移除(2026-09-09 由磁盘先行回放取代,见 09-09 spec) |
| 2026-09-08 | [午后提交全量代码审核(15 笔,2 高/1 P1/20 P2)](review/2026-09-08-postnoon-commits-review.md) | 已完成(报告;高级发现已修复) |
| 2026-09-08 | [智能体/提示词资产:需求澄清(对标 codemoss)](brainstorm/2026-09-08-assistant-assets.md) | 已收敛 |
| 2026-09-08 | [智能体/提示词资产设计:composer 双触发 + 设置管理](superpowers/specs/2026-09-08-assistant-assets-design.md) | 已落地(实现随 fa24fa3 提交;差异与遗漏标记见 spec 文末实现对照) |
| 2026-09-08 | [早晚场提交代码审核(19 笔,1 高/5 P1/15 P2)](review/2026-09-08-evening-commits-review.md) | 已完成(报告;高与 P1 已修复,桩目检通过) |
| 2026-09-09 | [0.1.3 发布区全量代码审查(48 提交,三路并行)](review/2026-09-09-0.1.3-release-review.md) | 已完成(报告;P0 口径已修正,整改清单待拍板) |
| 2026-09-09 | [工作区别名:显示名覆盖(行内重命名)](superpowers/specs/2026-09-09-workspace-alias-design.md) | 已落地(commit 9ed4911;实现随 spec 同提交) |
| 2026-09-09 | [工作区分组:侧栏分组 + 设置页管理 + 右键移动(参考 codemoss)](superpowers/specs/2026-09-09-workspace-groups-design.md) | 已落地(3d22cc7;实现随 spec 同提交) |
| 2026-09-09 | [快捷键改键 + 悬浮提示键位(对标 codemoss)](superpowers/specs/2026-09-09-shortcuts-remap-tooltip-design.md) | 已落地(f6f334a + 9a758f5;实现随 spec 同提交) |
| 2026-09-09 | [CLI 独立配置:图形化编辑各 CLI 本地配置(交互原型)](design/cli-config-gui.html) | 已落地(提案归档 openspec/changes/archive/2026-09-09-cli-gui-config/,实现随提案同提交) |
| 2026-09-09 | [客户端内存占用分析与优化预案(含 codemoss 架构对照:看/跑解耦)](research/memory-usage-analysis.md) | 已落地(9e49ffd 起) |
| 2026-09-09 | [磁盘会话先行回放 + 进程惰性拉起设计(走法 1)](superpowers/specs/2026-09-09-disk-first-session-open-design.md) | 已落地(9e49ffd/515cd4d/55a7d87/beb927a) |
| 2026-09-09 | [磁盘会话先行回放 spec 对抗评审(7 发现全处置)](review/2026-09-09-disk-first-session-open-review.md) | 已完成(修订已实施) |
| 2026-09-09 | [磁盘先行回放整体任务终审(4×P1+7×P2 当日全修复)](review/2026-09-09-disk-first-final-audit.md) | 已完成(含 rebase 历史手术记录) |
| 2026-09-10 | [本地插件:用户磁盘插件目录 + 运行时动态加载](superpowers/specs/2026-09-10-local-plugins-design.md) | 已落地(origin 三分内置/本地/市场,~/.tmd-cli/plugins/,Blob 装载,turnSettled 对话即变,SHA-256 信任闸,版本库回退) |
| 2026-09-10 | [Ask 提醒不及时/后台不出现:写后抑制窗误伤根因评审与修复](review/2026-09-10-ask-watch-write-gate-review.md) | 已完成(修复已随评审落地) |
| 2026-09-10 | [checkpoints 工作区外文件入账设计](superpowers/specs/2026-09-10-checkpoints-external-files-design.md) | 已落地(当日实施) |
| 2026-09-10 | [README/README_EN 双语刷新(10 CLI/25 注册插件/本机插件/CLI 独立配置/v0.1.4 产物矩阵,5 张新截图)](../README_EN.md) | 已落地 |
| 2026-09-10 | [0.1.4 周期全量代码评审(1 blocker + 1 major + 15 minor)](review/2026-09-10-0.1.4-cycle-review.md) | 已完成并全部修复(信任闸闭环 + 激活状态机修正,验证全绿) |
| 2026-09-10 | [codemoss(ccgui-next) 插件系统 vs tmd-cli 插件架构对比评审](review/2026-09-10-codemoss-plugin-architecture-comparison.md) | 已完成(六维对照 + 互鉴清单;两侧事实均实读核实) |
| 2026-09-10 | [首页重设计 · 终端窗体全动作行(定稿方案)](design/home-redesign-s-full-actions.html) | 已定稿(探索批 A-R/T-W 已废弃删除;spec 见同日 superpowers/specs) |
| 2026-09-11 | [首页终端窗体重设计(全动作行):welcome 整页重构 + 行内动作簇 + 新会话直达](superpowers/specs/2026-09-11-home-terminal-redesign-design.md) | 已确认(实现随本 spec 提交) |
| 2026-09-10 | [react-doctor 治理链 + dsh 0.1.2 适配评审](review/2026-09-10-react-doctor-refactor-review.md) | 已落地(本日审完即修;P1×3/P2×3 全部修完,验证全绿;P3×7 缓修) |
| 2026-09-10 | [Composer 输入历史(召回 + ghost 补全 + 管理区)需求澄清](brainstorm/2026-09-10-composer-prompt-history.md) | 已落地(kernel/promptHistory + composer 三拆件 + settings 新字段;当日实施并目检) |
| 2026-09-10 | [Composer 输入历史落地自评审(2 个 P2 当场修复 + 3 个 P3 缓修)](review/2026-09-10-composer-prompt-history-review.md) | 已完成(合成事件展开丢原型方法事故记录;验证全绿) |
| 2026-09-11 | [首页 token 用量 dashboard 设计原型(按引擎 + 近 7 日趋势)](design/token-usage-dashboard.html) | 已定稿(方案 B;vision 6 轮回归通过) |
| 2026-09-11 | [首页 token 用量 dashboard 设计(welcome 新增 TokenDashboard,本地 JSONL usage 聚合)](superpowers/specs/2026-09-11-token-dashboard-design.md) | 已落地(TokenDashboard + tokens 聚合层 + 单测;零消耗隐藏、量标柱尖) |
| 2026-09-11 | [CLI 独立配置:供应商渠道(Provider Channels,claude+codex 真切换 + ccswitch 手动导入)](superpowers/specs/2026-09-11-cli-provider-channels-design.md) | 已落地(4192b0e;OMP/PI 与 OAuth 留 V2+) |
| 2026-09-11 | [会话档案馆设计:跨引擎会话检索 + 零进程只读回放 + 日志保留策略](superpowers/specs/2026-09-11-session-archive-design.md) | 暂缓(09-11 价值复核不排期;M1 元数据档案+保留策略 → M2 FTS5 trigram 全文 → M3 跨源出口,待触发重启) |
| 2026-09-11 | [会话生命周期状态机契约:四态模型 / 八条不变量 / 闸门矩阵 / 七次事故账本](architecture/08-session-lifecycle.md) | 生效中(核心基础;改 activityWatch 前必读) |
| 2026-09-11 | [横评广播:同一 prompt 并行喂 N 个引擎 + 活幕布真并排(鱼骨 DAG 的 1/10 兑现)](superpowers/specs/2026-09-11-collab-broadcast-design.md) | 已废弃(实施后验收否决广播编排;分屏红利改「会话 tab 平铺显示」落地,spec 留档备鱼骨重启) |
| 2026-09-11 | [横评广播交互原型(浅色 4 态:入口 / 选引擎 / 分屏 / 失败终态)](design/collab-broadcast-prototype.html) | 设计原型(随 spec 废弃留档) |
| 2026-09-11 | [WSL 工作区 M1 设计:kind 路由 + UNC 现有原语复用](superpowers/specs/2026-09-11-wsl-workspace-m1-design.md) | 已落地(2026-09-12 十六轮实施验收,双形态真机通过;契约沉淀 architecture/09-wsl-contract.md) |
| 2026-09-11 | [WSL 支持交互原型 ×3(连接与远程调用 / 会话列表管理 / 文件工作区)](prototypes/) | 设计原型(调研结论:Workspace kind/distro + wsl.exe spawn 包装 + UNC 喂现有 fs 原语;git M1 降级) |
| 2026-09-11 | [后台会话「等待确认」不出现:字节通道结构性漏检评审与屏幕镜像修复](review/2026-09-11-ask-background-mirror-review.md) | 已完成(修复已随评审提交;真实日志回放实证 + 桩目检徽章上屏) |
| 2026-09-11 | [活动守望证据分级模型:轮次状态机根治重构(content/tick/static 三级分类 + 证据钟 + 空轮宽限)](superpowers/specs/2026-09-11-activity-watch-evidence-model-design.md) | 已落地(真实 omp 字节流回放验收;08 契约同步修订) |
| 2026-09-12 | [WSL 支持契约:发行版建模 / 双通道 spawn / 远程内省 / 分组身份 / 降级矩阵](architecture/09-wsl-contract.md) | 生效中(提案归档 openspec/changes/archive/2026-09-12-wsl-workspace-m1;改 wsl 插件/远程会话链路前必读) |
| 2026-09-13 | [omp 预热接管契约:acquireResume 钩子 / 影子会话 / 注入热切换 / 熔断降级](architecture/10-omp-prewarm-resume.md) | 生效中(改 cli-omp 打开历史链路前必读) |
| 2026-09-13 | [工作区壁纸契约:表面 token 打穿 / 壁纸态层梯 / 流体着色器](architecture/11-wallpaper-surface-contract.md) | 生效中(改壁纸插件/主题 token/终端底色/shell 层叠前必读) |
| 2026-09-13 | [codemoss 工作区壁纸(自定义背景)盘点](research/codemoss-workspace-wallpaper.md) | 已完成(数据模型/渲染层/打穿 CSS/Rust 受管文件全链路 + tmd-cli 移植映射与决策点) |
| 2026-09-13 | [壁纸/流体插件性能与边界评审](review/2026-09-13-wallpaper-perf-boundary.md) | 已完成(P1×2 随评落地:缩略图懒加载/xterm 底色锚定归 kernel;P2 缓解选项留实测定夺) |
| 2026-09-13 | [近十次提交全局代码审查](review/2026-09-13-ten-commits-global-audit.md) | 已完成(无 P0;1 项 P2 退出丢改动 + 7 项 P3 边角,深水区九项核查无虞) |
| 2026-09-14 | [v0.1.7 发布范围评审与收口](review/2026-09-14-v017-release-review.md) | 已完成(无 P0;5 P1 全修 + 19 P2,6 条 report-only;门禁全绿 react-doctor 100) |
| 2026-09-15 | [v0.1.8 前置批次评审(双栏 diff/创建 PR/历史行)](review/2026-09-15-pr-splitdiff-review.md) | 已完成(无 P0;3 P1 修 2 + 9 P2 修 7;门禁全绿 react-doctor 100) |
| 2026-09-15 | [git 插件「创建 PR」工作流设计:预检/推送/建 PR/可选审批评论](superpowers/specs/2026-09-15-git-create-pr-design.md) | 已落地(四步工作流 + 阶段实时卡;同日修订:范围闸门移除,PR 内容零本地限制;AI 生成留 v2) |
| 2026-09-15 | [omp 版本回退:首页引擎卡版本菜单 + 收藏](superpowers/specs/2026-09-15-omp-version-rollback-design.md) | 已评审通过(实现随本 spec 提交) |
| 2026-09-15 | [双栏 diff GitHub 风视觉打磨](superpowers/specs/2026-09-15-split-diff-github-style-design.md) | 已落地(行号各半内侧缘 + 缺侧空带 + 词级实色块;删中央槽/⤶钩/⬚占位/块框) |
| 2026-09-15 | [双栏 diff 中缝连接带视觉迭代](superpowers/specs/2026-09-15-split-diff-center-seam-design.md) | 已落地(列序翻转为左内容|旧号|新号|右内容,改动行色带贯通中缝;号格单发丝) |
| 2026-09-15 | [手机 App 外网访问 tmd-cli 方案调研(服务面/通道/壳三层解耦,有 ECS 与无 ECS 两组通道 + iOS 壳三路线)](research/mobile-remote-access.md) | 调研底稿(方案对比,未拍板) |
| 2026-09-15 | [codemoss Web/远程访问实现源码级分析(LAN 桥/出站中继/传输抽象/治理面 + tmd-cli 移植映射)](research/codemoss-web-remote.md) | 已完成(配套提案 openspec/changes/2026-09-15-web-remote-access/) |
| 2026-09-16 | [git 双栏 diff 方向探索 ×6(保留基准 V2 双向纹 + N1 明度 / N2 聚光灯 / N3 权重 / N4 折叠焦点 / N5 斑马打断;同一份 diff 差异化对比)](design/git-split-diff-v2-hatch-directional.html) | 设计原型(V2 已保留,N1-N5 见 git-split-diff-n1~n5-*.html,待选) |
| 2026-09-16 | [会话看板 · 热力月历 + 泳道时间线日视图(热力/周条/节律条 + 小时时轨 × 五态垂直泳道分带对齐 + 未查看治理点 + 卡上重命名;90 天 ~1800 会话密度实测)](design/session-calendar-heat-agenda.html) | 设计原型(定稿候选;六轮目检迭代;前期 A-E/综合版/F~H 探索方案已删) |
| 2026-09-16 | [会话看板设计 spec(热力月历 + 泳道时间线 + 生命周期五态;插件化落地)](superpowers/specs/2026-09-16-session-board-design.md) | 已落地(session-board 插件,实施纪要见 spec) |
| 2026-09-17 | [Web 远程访问桥 M1/M2 契约:transport 继承 R3 / event_sink 双扇出 / 命令镜像与信任模型 / 停机语义 / /file 允许制 / LAN 绑定 / 中继链路](architecture/12-web-remote-access.md) | 生效中(改 web 域/transport/event_sink/relay 前必读;含 18 笔整体 review 决策) |
| 2026-09-17 | [本地 18 笔整体 code review(git 双栏/web 桥/kernel 状态/看板四域;P1×1 + P2×7 全修)](review/2026-09-17-18-commits-global-review.md) | 已完成(修复随本批提交;门禁全绿 react-doctor 100) |
| 2026-09-18 | [编辑器扩展与终端链接宿主契约](architecture/13-editor-extensions-terminal-links.md) | 生效中(改 marks / CM 扩展注入 / 幕布链接前必读;原 11 号与壁纸撞号,09-19 改 13) |
| 2026-09-19 | [LSP 语义跳转契约(分层/会话续期与断连自愈/交互手势/peek 面板)](architecture/14-lsp-semantic-nav.md) | 生效中(改 lsp 插件/语义跳转前必读) |
| 2026-09-18 | [双栏 diff 折叠焦点设计(全文态 context 段胶囊就地展开,N4 原型落地)](superpowers/specs/2026-09-18-split-diff-n4-collapse-focus-design.md) | 已落地(commit c126047;评审收口 UX 路:spec 补盘 + 双胶囊读屏去重) |
| 2026-09-18 | [文件标记 × 对话框交互原型 ×3(A 行间锚点 / B 右侧标注面板 / C 选区即引用)](design/file-mark-composer-a.html) | 设计原型(三选一待拍板;B/C 见同目录 -b/-c) |
| 2026-09-18 | [文件标记 × 对话框原型 方案 D:行间锚点 + 全局标记中心(跨文件聚合发送,sidecar 零写入 + 指纹锚定)](design/file-mark-composer-d.html) | 设计原型(已拍板) |
| 2026-09-18 | [文件标记(file-marks)设计 spec:插件化 + 两条 kernel 宿主注册契约](superpowers/specs/2026-09-18-file-marks-design.md) | 已落地(cbe7839/a157610/6317d86;宿主契约见 architecture/13) |
| 2026-09-18 | [会话状态轮询性能批次一提案:尾读尺寸闸 + configHomeDir 进程 memo(含原设计校准矩阵)](../openspec/changes/archive/2026-09-18-perf-status-poll/proposal.md) | 已落地(4e859fd/9aa8f77/66599b9;同批平铺门控修复 0f6131e,已归档) |
| 2026-09-18 | [yn(Yank Note)能力复刻:md 渲染提速 + 代码渲染 + 全文搜索/快开](superpowers/specs/2026-09-18-yn-replicate-md-render-code-search-design.md) | 已落地(f176423/15e7e60/2c58d44;AGPL/MIT 裁决:照抄逻辑不抄代码) |
| 2026-09-19 | [近 20 笔提交整体 code review(P0×1 + P1×2 + P2×8 全修;marks/git/yn/perf/跨领域五路)](review/2026-09-19-20-commits-global-review.md) | 已完成(修复随本批提交;门禁全绿 react-doctor 100;缓修 4 项见文末) |
| 2026-09-19 | [代码符号跳转与引用(cmd/ctrl+click)调研:yn 实证 + 多语言语义路线(LSP)](research/code-symbol-references.md) | 调研底稿(方向已定:yn 本就是语义引用;用户拍板弃字面,一步到位 LSP 语义通道) |
| 2026-09-19 | [代码符号语义跳转与引用(LSP 通道)设计:cmd/ctrl+click 定义/引用 peek](superpowers/specs/2026-09-19-lsp-semantic-navigation-design.md) | 已落地(c11c29c;TS7 探活分叉回填 112f971;桩目检六场景 + tsgo 真机冒烟全绿) |
| 2026-09-19 | [LSP 语义跳转交互增强(二轮):手势反馈 / peek 面板 / hover 渲染](superpowers/specs/2026-09-19-lsp-interaction-enhancement-design.md) | 已落地(db938d6;桩目检六场景全绿,架构沉淀 architecture/14) |
| 2026-09-19 | [会话卫生清扫设计:超期(默认24h)自动归档 + 空会话删除,挂磁盘扫描结算点零轮询](superpowers/specs/2026-09-19-session-hygiene-auto-archive-design.md) | 已落地(1e75245;keep 覆盖层 + 9 引擎判空钩子 + 行为页开关/时窗) |
| 2026-09-19 | [v0.2.0 发布后批次评审(sidekick 开关冲突修复 / 数组守卫补漏 / 死代码清理 / 文档 8 处对齐)](review/2026-09-19-v0.2.0-postrelease-review.md) | 已完成(修复与清理随评审提交) |
| 2026-09-19 | [打开方式(Open With)设计:复刻 mossx(设置配置面板 + 文件底部入口菜单)](superpowers/specs/2026-09-19-open-with-design.md) | 已落地(实现随本批提交;入口仅文本族文件视图) |
| 2026-09-20 | [近八笔提交全量审核(open-with/wsfb/md 目录/最大化/更新感应;P1×1+P2×3+P3×17 修 16 缓修 4)](review/2026-09-20-8-commits-global-review.md) | 已完成(修复随本批提交;门禁全绿 react-doctor 100;Windows 分隔符专项待排) |
| 2026-09-20 | [0.2.2 打磨期全量功能体检(v2 复核定稿:逐条实读复核,1 P1 + 10 P2 + 27 P3;删 1 误报、校准 11 处行号)](review/2026-09-20-022-polish-survey.md) | 已收口(8 批修复落地,见 0.2.2 CHANGELOG) |
| 2026-09-20 | [0.2.2 打磨期任务分解(P1 发送收口/原子写簇/PTY 收尸/搜索完整性/git 打磨/UX 习惯批/P3 池)](../openspec/changes/archive/2026-09-20-022-polish/tasks.md) | 已完成(45 项完成 43;缓修 2 项板内注明:双实例文件锁/QuickOpen walk 缓存;UI 真窗口目检待用户侧) |
| 2026-09-21 | [orca mobile 模块源码级分析(QR 配对/E2EE/二进制终端流/占用仲裁/开发基建;tmd-cli mobile app 对标蓝本与学习清单)](research/orca-mobile-reference.md) | 已完成(学习清单 1-6 为壳无关的 mobile 就绪底座;壳选型待拍板) |
| 2026-09-21 | [mobile app 设计(轻交互 · 配对不加密;QR 配对/设备表/dispatch scope/壳工程/通知)](superpowers/specs/2026-09-21-mobile-app-design.md) | 已评审通过(壳实定=原生 SwiftUI+WKWebView,Tauri iOS 流水线 Xcode 27 上游阻断;功能面/安全档拍板不变) |
| 2026-09-21 | [mobile app UI 原型 ×4(配对流程 / 远程 home / 会话屏实况+审批+发送 / 设备管理与边界态)](prototypes/mobile-app-pairing.html) | 设计原型(浅色主题实测基准;同目录 -home/-session/-device-edge-states 三页配套;共享样式 mobile-app-shared.css = 统一手机壳/桌面窗框/设计 token) |
| 2026-09-21 | [mobile app 实施总计划(终态验收清单 + M1 配对底座/M2 轻交互闭环/M3 发布候选)](superpowers/specs/2026-09-21-mobile-app-master-plan.md) | 生效中(M1 已收口归档;M2 细化中:openspec/changes/2026-09-22-mobile-app-m2-light-interaction/) |
| 2026-09-23 | [手机会话屏紧凑化 + 键盘工具条做实(单顶栏/审批芯片 sheet/真实键序列;切模型走 CLI /model TUI)](superpowers/specs/2026-09-23-mobile-session-compact-interaction-design.md) | 已落地(ab09119;桩目检全绿,真机待装机验收) |
| 2026-09-24 | [外网中继拆分 Cloudflare/自建服务器 + 一键 SSH 部署(动态证书钉住)](superpowers/specs/2026-09-24-selfhost-relay-deploy-design.md) | 已落地 |
| 2026-09-24 | [第二轮 code review:修复审计/线协议契约/生命周期/测试质量(修第一轮 2 回归 + P1x5;补测债 6 件)](review/2026-09-24-round2-fixaudit-contract-lifecycle-tests.md) | 已完成(修复同轮收口) |
| 2026-09-24 | [手机端与远程连接 114 提交全量 code review(P0×1/P1×12/P2 修 18 项;src/mobile 树准入)](review/2026-09-24-mobile-web-114-commits-review.md) | 已完成(修复同轮收口;线上中继待重部署) |
| 2026-09-25 | [手机会话通用渲染:codemoss 视觉重皮 + transcript 实时生长](superpowers/specs/2026-09-25-mobile-session-render-design.md) | 已落地并真机验收(6a9ab6c;反馈迭代:c1bc686 toolResult 文本墙修复、f18baec 助手正文 markdown 渲染) |
| 2026-09-25 | [审批收件箱 + 手机一键放行交互原型(桌面右栏页签 + 手机壳一键作答;消费 askWatch 状态位,作答走 writeSession)](design/approval-inbox.html) | 设计原型 |
| 2026-09-25 | [跨会话文件冲突雷达原型(编辑入账跨会话 join + 触碰时间轴 + 双侧 mini diff 对照;只预警不拦截)](design/session-conflict-radar.html) | 设计原型 |
| 2026-09-25 | [审批收件箱设计:桌面右栏聚合等待确认会话,直达 + 自由文本应答(检测零新增;预设代发键否决遵 M2 评审 A2)](../openspec/changes/2026-09-25-approval-inbox/proposal.md) | 已落地(真机目检待大仙;approval-inbox 插件随本提案提交) |
| 2026-09-25 | [审批收件箱换角度评审(功能完整性/架构边界/系统兼容;P1 幽灵行 + 7 项全当场修)](review/2026-09-25-approval-inbox-review.md) | 已完成(修复同批提交) |
| 2026-09-25 | [omp 学堂一体化学习体系原型(左栏入口 + 13 课入门 + 指南 tab + composer 斜杠抽屉,四面对互打通)](design/omp-learning-system.html) | 已定稿(见同日 spec) |
| 2026-09-25 | [CLI 学堂(cli-academy)设计:多 CLI 通用引导学习体系(kernel 课程注册面 + cli-* 供数据 + academy feature 插件;omp 首接入 82 命令/13 课)](superpowers/specs/2026-09-25-cli-academy-design.md) | 已落地(dd78bae/d86e1b5/80554fb;阶段 1-3 双轮 review PASS;真窗口已启动,目检清单待大仙) |
| 2026-09-25 | [15 — CLI 学堂契约:课程注册面/AcademyCourse 结构/供给方与消费方职责/练习桥时序/契约测试](architecture/15-cli-academy.md) | 已落地(随 cli-academy 实施) |
变更契约不在本目录:进行中见 `openspec/changes/`,已归档见 `openspec/changes/archive/`,正式能力规格见 `openspec/specs/`。

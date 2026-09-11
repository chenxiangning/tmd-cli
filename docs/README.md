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
| 2026-09-03 | [omp 最近版本升级记录(v18.0.7-18.1.6)](research/omp-cli-course/releases.md) | 持续更新 |
| 2026-09-01 | [基础架构总览](architecture/01-overview.md) | 已落地(09-06 校准) |
| 2026-09-01 | [代码级架构（Mermaid）](architecture/02-code-architecture.md) | 对齐当前代码(09-07 校准:删除意图 tombstone/会话删除顺序/归档容量与分页/dsh 删除与空壳契约;**09-10 校准**:dsh 5.2 改以 0.1.2 斜杠方法面 + /api/remote.mux 双流实测契约,补 react-doctor 治理原则 9 表) |
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
| 常态 | [功能清单 FEATURES](FEATURES.md) | 随代码演进(09-08 顶栏 tab 条/界面字号校准) |
| 2026-09-04 | [Git 历史视图 Graph 化 + 提交 diff 进左侧文件容器](superpowers/specs/2026-09-04-git-history-graph-design.md) | 已落地 |
| 2026-09-04 | [文件渲染档案:补齐 codemoss 全量文件预览形态](superpowers/specs/2026-09-04-file-render-profiles-design.md) | 已落地 |
| 2026-09-04 | [SSH 模块竞品调研](research/ssh-module-reference.md) | 已完成 |
| 2026-09-04 | [SSH 插件需求澄清(竞品调研)](brainstorm/2026-09-04-ssh-plugin.md) | 已收敛 |
| 2026-09-04 | [SSH 插件设计:一等会话 + 右栏 SFTP 树 + 端口转发](superpowers/specs/2026-09-04-ssh-plugin-design.md) | 已落地(引擎端到端实测,契约见 openspec/changes/ssh-plugin/) |
| 2026-09-04 | [文件 tab 右键菜单 + 编辑区最大化切换设计](superpowers/specs/2026-09-04-tab-menu-editor-maximize-design.md) | 已落地 |
| 2026-09-04 | [插件边界审计 + 死代码清理](review/2026-09-04-boundary-deadcode-cleanup.md) | 已完成(diskSessions 下沉 cli-shared / 面板 subbar 注册化 / edits 骨架收敛 / 88 处导出降级) |
| 2026-09-04 | [Composer 触发器补全重构:以 CLI 为真相源(需求澄清)](brainstorm/2026-09-04-composer-cli-sourced-suggestions.md) | 已收敛 |
| 2026-09-04 | [Composer 触发器补全重构:`/` `$` `@` 以 CLI 为真相源](superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md) | 已落地 |
| 2026-09-04 | [Diff 视图噪音清理:hunk 分隔条](superpowers/specs/2026-09-04-diff-noise-cleanup-design.md) | 已落地 |
| 2026-09-05 | [Git 差异面板文件列表:F 终端风重构](superpowers/specs/2026-09-05-git-diff-filelist-f-terminal-design.md) | 已确认 |
| 2026-09-05 | [Git 远端操作对话框复刻(codemoss push/pull/fetch)+ 顶栏聚合数字迁移](superpowers/specs/2026-09-05-git-remote-dialogs-design.md) | 已落地 |
| 2026-09-05 | [分支右键菜单对齐 codemoss:变基/合并/对比/重命名/自指定分支新建](superpowers/specs/2026-09-05-branch-menu-parity-design.md) | 已落地 |
| 2026-09-05 | [会话 tab 右键菜单:重命名 + 关闭一套](superpowers/specs/2026-09-05-session-tab-context-menu-design.md) | 已落地 |
| 2026-09-05 | [会话状态标签:结算归因修正 + SIGWINCH 重绘抑制窗](superpowers/specs/2026-09-05-session-status-settle-attribution-design.md) | 已落地 |
| 2026-09-05 | [审批线隔离与精准手术:纯事件归因 · 批审计冻结 · 共改文件 diff 擦除](superpowers/specs/2026-09-05-checkpoints-isolation-surgery-design.md) | 已落地 |
| 2026-09-05 | [插件化架构审查与插座化重构(评审记录)](review/2026-09-05-plugin-socket-refactor.md) | 已落地 |
| 2026-09-05 | [8 引擎 Memory 治理集成设计 —— Magic Context 走法 B](research/magic-context-8-engine-integration.md) | 已被 spec 取代(保留作调研底稿) |
| 2026-09-05 | [8 引擎 Memory 集成设计评审(走法 B 首稿)](review/2026-09-05-memory-integration-design-review.md) | 已完成(不通过,退回修订) |
| 2026-09-05 | [Memory Coordinator 设计:Magic Context 记忆池 + 双通路注入(8 引擎)](superpowers/specs/2026-09-05-memory-coordinator-design.md) | 已落地(§8 UI 定稿并入;实施契约见 openspec/changes/memory-coordinator/) |
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
| 2026-09-06 | [omp 扩展市场:cli-omp 二级插件安装/卸载](superpowers/specs/2026-09-06-omp-extension-market-design.md) | 已落地(实现随本次提交;装卸启停真窗终验中) |
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
| 2026-09-09 | [CLI 独立配置:图形化编辑各 CLI 本地配置(交互原型)](design/cli-config-gui.html) | 已落地(提案 openspec/changes/cli-gui-config/,实现随提案同提交) |
| 2026-09-09 | [客户端内存占用分析与优化预案(含 codemoss 架构对照:看/跑解耦)](research/memory-usage-analysis.md) | 已落地(9e49ffd 起) |
| 2026-09-09 | [磁盘会话先行回放 + 进程惰性拉起设计(走法 1)](superpowers/specs/2026-09-09-disk-first-session-open-design.md) | 已落地(9e49ffd/515cd4d/55a7d87/beb927a) |
| 2026-09-09 | [磁盘会话先行回放 spec 对抗评审(7 发现全处置)](review/2026-09-09-disk-first-session-open-review.md) | 已完成(修订已实施) |
| 2026-09-09 | [磁盘先行回放整体任务终审(4×P1+7×P2 当日全修复)](review/2026-09-09-disk-first-final-audit.md) | 已完成(含 rebase 历史手术记录) |
| 2026-09-10 | [本地插件:用户磁盘插件目录 + 运行时动态加载](superpowers/specs/2026-09-10-local-plugins-design.md) | 已实现未提交(origin 三分内置/本地/市场,~/.tmd-cli/plugins/,Blob 装载,turnSettled 对话即变,SHA-256 信任闸,版本库回退,零影响承诺) |
| 2026-09-10 | [Ask 提醒不及时/后台不出现:写后抑制窗误伤根因评审与修复](review/2026-09-10-ask-watch-write-gate-review.md) | 已完成(修复随记录同在工作树) |
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
| 2026-09-11 | [CLI 独立配置:供应商渠道(Provider Channels,claude+codex 真切换 + ccswitch 手动导入)](superpowers/specs/2026-09-11-cli-provider-channels-design.md) | 待评审(设计定稿,未提交;OMP/PI 与 API Key/自定义/OAuth 留 V2+) |
| 2026-09-11 | [会话档案馆设计:跨引擎会话检索 + 零进程只读回放 + 日志保留策略](superpowers/specs/2026-09-11-session-archive-design.md) | 暂缓(09-11 价值复核不排期;M1 元数据档案+保留策略 → M2 FTS5 trigram 全文 → M3 跨源出口,待触发重启) |
| 2026-09-11 | [会话生命周期状态机契约:四态模型 / 八条不变量 / 闸门矩阵 / 七次事故账本](architecture/08-session-lifecycle.md) | 生效中(核心基础;改 activityWatch 前必读) |
| 2026-09-11 | [横评广播:同一 prompt 并行喂 N 个引擎 + 活幕布真并排(鱼骨 DAG 的 1/10 兑现)](superpowers/specs/2026-09-11-collab-broadcast-design.md) | 待评审(设计定稿,未实现) |

变更契约不在本目录:进行中见 `openspec/changes/`,已归档见 `openspec/changes/archive/`,正式能力规格见 `openspec/specs/`。

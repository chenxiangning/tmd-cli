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
| 2026-09-01 | [代码级架构（Mermaid）](architecture/02-code-architecture.md) | 对齐当前代码(09-06 校准) |
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
| 常态 | [功能清单 FEATURES](FEATURES.md) | 随代码演进(09-06 发版前补校) |
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
| 2026-09-06 | [左侧工作区会话分类折叠(CLI/终端/SSH 段头开关 + 折叠计数 + settings 持久化)](superpowers/specs/2026-09-06-workspace-group-collapse-design.md) | 已落地(实现随本 spec 提交) |
| 2026-09-06 | [omp 扩展市场:cli-omp 二级插件安装/卸载](superpowers/specs/2026-09-06-omp-extension-market-design.md) | 已评审通过(待实施) |
| 2026-09-06 | [快捷键终端聚焦期放开:global 不再静默 + Ctrl+Tab 死键位修复](superpowers/specs/2026-09-06-shortcuts-terminal-focus-design.md) | 已落地 |

变更契约不在本目录:进行中见 `openspec/changes/`,已归档见 `openspec/changes/archive/`,正式能力规格见 `openspec/specs/`。

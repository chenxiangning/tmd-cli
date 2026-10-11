# 工作台并入每日工作日志(合并 + 入口统一 + 项目/任务关联)设计

- 日期:2026-10-11
- 状态:已实施(三阶段 TDD + 三轮评审收口;评审记录 docs/review/2026-10-11-workbench-journal-merge-review.md;真机目检留大仙)
- 需求来源:大仙——每日工作日志与工作台合并优化,嵌入工作台,能关联工作台的任务与项目;入口统一到工作台;插件化与模块化边界整利索。
- 前置调研:docs/research/workbench-daily-journal-merge.md(2026-10-11,结论可行)

## 背景与目标

daily-journal 与 workbench 两 feature 插件此前零耦合,分别持有「按日会话索引 + AI 汇总文章」与「项目/任务管理」两套互相可派生关联的数据。合并后:

1. **一个插件**:`daily-journal` 退出插件清单,代码作为 `workbench/journal/` 子域存活;kernel/Rust 零改动。
2. **入口唯一**:左 rail 只剩「工作台」;日志以工作台页签「日志」进入(年/月/轴三视图);`daily-article` 文章 tab 保留为深链。右栏 JournalPanel 宿主与 `daily-journal` 主视图中央 tab 退役。
3. **关联派生**:日↔项目(`DaySessionRow.wsId` → Workspace.root ↔ `Project.cwd`)、日↔任务(`TaskSessionLink(disk)` ↔ 行身份)全部运行时派生,不新增落盘格式。
4. **生成项目感知**:文章生成 prompt/摘录按项目分组注入,文章可出「分项目」节。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 合并形态 | 目录整体迁移 `workbench/journal/`,插件注册从 allPlugins 删除,workbench.activate 经子域入口 `attachJournal(ctx)` 装配 | 双插件跨插件 import;journal 下沉 kernel | 跨插件 import 违插件独立性纪律;单插件语义不入 kernel;调研实证合并面仅 2 行注册 + 1 行契约测试 |
| 入口统一 | 工作台页签「日志」承载主视图;`daily-article` 深链保留;`registerFilePanel`/主视图 tab/openJournalTab 退役 | 保留右栏面板做第二入口 | 大仙口径「入口统一到工作台」;右栏宿主只是 FlowView 的壳,轴视图收编为主视图第三视图后无功能损失;UnfinishedPanel 本就在 ArticleTab 内不受影响 |
| 视图收编 | JournalTab 视图路由 年/月 扩为 年/月/轴(FlowView 复用) | 轴视图弃置;轴视图独立页签 | 复用现成组件零重写;轴视图是原型三视图之一,弃置丢能力,独立页签加冗余 |
| 关联存储 | 运行时派生(纯函数),不落盘 | meta.json 加 taskRefs 持久关联 | 单一事实源,无同步问题;需要硬关联时 DayMeta 开放形状可 additive 扩展 |
| 日↔项目映射 | `Project.cwd === Workspace.root` 精确匹配(行身份是 wsId 不是会话 cwd) | 前缀模糊匹配 | 前缀会把工作区内所有会话摊给其下所有项目,过关联;精确匹配语义干净,子目录绑定项目本就以工作区根为会话宿主 |
| 生成注入 | runGeneration 先 `ensureWorkbenchLoaded()`,行按项目分组进 prompt/摘录;workbench 数据不可用时静默降级为现行为 | 强依赖 workbench store | 生成链已有「摘录失败不拦生成」降级先例;项目分组是增强不是前置 |
| 词典 | journal 域词典随目录迁移原样注册;新增页签键「日志」入 workbench 域 | 全量并入 workbench 词典 | 两域交集 7 键值全同(实证),迁移零撞车;域归属跟文件走 |

## 实施分期(每期 TDD + 评审后才进下期)

- **P1 合并与入口统一**:契约测试先行(红)→ git mv → 退役清单(registerFilePanel/JOURNAL_TAB_KIND/openJournalTab/JournalPanel)→ JournalTab 三视图 → attachJournal 装配 → 全门禁。
- **P2 关联层**:纯函数 `dayLinks`(日↔项目/日↔任务)测试先行 → ArticleTab 当日关联区(项目 chip → 项目详情 tab)→ 全门禁。
- **P3 生成项目感知**:promptGen/sessionDigest 分组注入测试先行 → runGeneration 接 workbench 快照 → 全门禁。

## 验证(计划,随实施回填)

- 每期:typecheck 0 错 / 全量测试 / check:arch-boundary / check:file-size;P1 起词典死键审计(正则口径见 memory)。
- 收口:react-doctor 100 + pnpm build + 1421 桩目检(工作台→日志页签三视图/文章 tab 深链/关联 chip/轴视图折叠)+ 文档对码(FEATURES.md、architecture 01/02 插件计数)。
- 提交:显式文件清单 git add,不触碰并行在途文件(workbench 4 文件:ProjectDetail/TaskDetailDialog/sessionOpen×2)。

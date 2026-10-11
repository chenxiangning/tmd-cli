# 生成文档闭环(docgen)设计

- 日期:2026-10-11
- 状态:已实施(P1 生成闭环 + P2 结构化回写 + 每周排程;P3 自定义模板管理/导出/项目抽屉内嵌阅读器留后。落地契约沉淀 `docs/architecture/22-docgen.md`;1421 桩目检闭环全链通过)
- 交互原型:`docs/design/doc-gen-fused.html`(headless 全交互冒烟通过)

## 背景与目标

工作台「生成文档」现状 = `OverlayActions` 菜单 5 项(进展分析提示词/周报/项目状态汇报/风险清单/会议纪要骨架)→ `DocPreviewDialog` 静态模板预览 + 复制。断点:**没有 AI 调用、没有产物沉淀、没有结构化查看、没有落地回写** —— 用户拿到一版模板文本,闭环要自己走完。

目标:把「生成文档」升级为一条 AI 文档流水线,补全闭环五环:

```mermaid
flowchart LR
    A[配置弹窗<br>模板x事实源x参数] --> B[真实 CLI 会话<br>无头单发生成]
    B --> C[产物落盘<br>版本链沉淀]
    C --> D[结构化阅读<br>溯源+对比]
    D --> E[落地分发<br>转任务/项目文档/输入框/追问]
```

复用基座(journal 已验证,同插件内直接 import):`journal/genSession.ts` 的 spawn→结算生命周期(oneshotArgs 无头单发 / oneshotStdin 注入 / 文件落盘=完工信号 / fileEditDetected 事件)、`journal/sessionDigest.ts` 的会话摘录适配、`taskQueue.ts` 的排队语义(3 槽并发/20 分硬顶/取消收割)。

## 方案取舍

| 决策点 | 选定 | 被否决 | 理由 |
|---|---|---|---|
| 生成队列 | docgen 自建轻队列 `docgenQueue.ts`(复刻 3 槽/20 分硬顶/取消收割语义,持久化进 docgen.json) | 泛化 journal taskQueue | taskQueue 是 dayKey 语义 + GenTaskType 字面量联合 + meta.json 持久化,journal 全家测试钉死其行为;泛化改类型联合与去重谓词,动稳定基座风险大于 120 行复刻。语义对齐而非代码共享,两队列互不感知 |
| 模板存储 | 内置模板 = 代码常量;自定义模板 = `~/.tmd-cli/workbench/doctemplates/<name>.md`(frontmatter 声明缺省事实源/受众/周期,正文含 `{{facts}}` `{{period}}` 占位符) | 复用 assets 提示词资产(~/.tmd-cli/prompts) | assets 的触发符/可见性/作用域语义耦合 composer 提示词场景;docgen 模板需结构化 frontmatter 字段,混存会互相污染语义。格式知识不出 workbench,无 cli-shared 准入问题 |
| 产物落盘 | `~/.tmd-cli/workbench/docgen.json`(记录索引:文档/版本/状态/排程)+ `workbench/docgen/<docId>/v<N>.md`(版本产物) | 登记进 workbench index.json | index.json 是 AI 会话按 AI-TASKS.md 规则直改的项目数据面;docgen 流水线元数据(版本链/排程/解析缓存)混入会被项目侧 AI 误伤。物理分档同 journal notes 与 article 的分档理由 |
| 结构化契约 | prompt 尾固定骨架(严格二级标题五段:概览/进展/风险/行动项/建议)+ 条目行内 `<!--src:...-->` 来源注释;解析失败整体回落 MarkdownBody 渲染 | fenced JSON 输出 | 长文档 JSON 模型易破格式且不可读;markdown 骨架即使解析失败产物本身仍是合格文档。GEN_TASK_MARK 同款「prompt 契约换可解析性」思路 |
| 入口 | 「生成文档」按钮 → `DocGenDialog`(DialogShell 居中双列弹窗);`DocPreviewDialog` 退役删除(含 ProjectDetail 概要页文档按钮组改弹此窗,范围预锁单项目) | 保留旧预览弹层并存 | 旧弹层是静态模板预览,新弹窗覆盖其全部能力(analysis 类型产出即复制);并存 = 两套「生成文档」心智。clean cutover |
| 文档页签位置 | `WB_TAB_ITEMS` 插入「文档」(待跟进与工作日志之间) | 塞进概览页/独立中央 tab | 页签行是工作台一级导航既有形制;文档与工作日志同为沉淀类,相邻;项目抽屉内文档页签后续复用阅读器组件(过滤单项目),本期不做 |

## 闭环设计

### 1 配置(模板 × 事实源 × 参数)

- 模板库:内置 5 类(周报/项目状态汇报/风险清单/会议纪要/发版说明)+ `analysis`(进展分析提示词,纯 prompt 不 spawn,产出即复制——保留现状能力)+ 自定义。每模板声明:标题骨架、缺省事实源、缺省受众、产物文件名规则。
- 事实源勾选:项目摘要(`prompt.ts` 的 `projectBrief`/`portfolioBrief` 现成)/ 工作日志(周期内 `journalFiles` 文章)/ 会话摘录(`sessionDigest` 适配器,周期过滤)/ Git 提交(工作区仓库 `git_log` 原语,周期过滤)。prompt 组装器按勾选拼装,缺省勾 项目摘要+工作日志。
- 参数:周期(本周/上周/本月;自定义区间留 P3)、范围(全部/单项目)、受众(管理层/团队/对外,拼进 prompt 语气段)、语言(跟随界面 i18n locale,prompt 语言段已落)、引擎(-profile 选择,弹窗徽标无头/stdin/TUI 兜底)、附加指令(拼 prompt 尾)。
- 定时排程:模板+参数+cron 语义(周 N HH:mm)存 docgen.json;对齐 `journalSchedule.ts` 已核实先例——**运行期 15 分钟对表**(TICK_MS),**boot 启动补跑**(上次运行后错过的窗口按幂等闸补一次,防 boot/tick 双发;「已错过不补」的保守语义被否决:周报类补跑价值高,journal 已实证该模式)。

### 2 生成(journal 生命线的姊妹实现)

`docgen/genSession.ts` 复刻 journal `runGeneration` 段式:组装 prompt(落盘 `docgen/<docId>/prompt-latest.md`,经 @file 传入防 argv 溢出)→ `host.createSession` spawn(引擎声明 `oneshotArgs` 走无头单发,`oneshotStdin` 走 PTY 注入,均 journal 已实证)→ 结算三路(fileEditDetected 命中产物路径 + 15s 轮询兜底 + 20 分硬顶判失败)→ 完成。区别:产物路径是 docgen 目录而非 daily/article;队列自建;成功后触发结构化解析。生成会话标题带 `DOC_GEN_MARK`(自指防混入,同 GEN_TASK_MARK)。

### 3 沉淀(版本链)

- 同 `模板×范围×周期` 维度键重复生成 → 追加 `v<N+1>`,不覆盖;行内徽标显最新版本数;版本 chips 可回看任意版(只读)。
- 文档状态机:`草稿 → 已汇报 → 已归档`,点击徽标循环,随 docgen.json 持久化。列表按日分组(今天/更早),失败行就地重试(同 prompt 换引擎可选)。「查看会话残留输出」依赖引擎落盘会话(omp oneshot --no-session 无残留),留 P3 评估。

### 4 结构化阅读(解析 + 溯源 + 对比)

- 解析器 `docgen/parse.ts`:按二级标题切五段,风险/行动项条目行提取等级标记与 `<!--src:...-->`;解析输出与原文并存(原文始终可查,复制/导出基于原文)。任一段缺失或条目不可解析 → 整体回落 MarkdownBody(先例 `journal/articleBody`)。
- 溯源:prompt 契约要求风险/行动项条目尾注来源(进展日期/日志日期/会话标题);解析成 source chip,点击跳转——进展 → 项目详情「进展」页签(openProjectTab focusTab,单项目范围;全部项目范围 toast 说明);日志 → 工作日志文章 tab(openArticleTab);会话 → 标题匹配绑定目录最近会话后 openDiskSession 磁盘恢复(单项目范围);提交 sha 跳转留 P3(toast 说明)。跳转不到(已删/无匹配)toast 说明,不猜。
- 状态徽流转:草稿 → 已汇报 → 已归档 → 草稿循环(点击徽标,随 docgen.json 持久化)。
- 对比视图:相邻两版解析结果的条目级 diff(键=条目文本骨架,值变=mod,新增=add,消失=del);纯前端计算,无需额外算法。

### 5 落地分发

- 转任务:风险/行动项/建议按钮 → `addTask(projectId, { title, owner, dueDate, description })`(store.ts:138,签名已核)写对应项目(范围=单项目直接落;全部项目时按条目的项目标注映射,缺标落第一个「进行中」项目并在 toast 说明);description 落「来源:文档《X》vN + 条目摘要」。转后按钮置绿防重(内存态,重进按来源标记判定)。
- 存为项目文档:走既有 `createDoc(projectId, { title, markdown })`/`writeDocFile` 落项目 docs 目录(storeDocs.ts:13,签名已核;DrawerDocsTab 即见)。
- 发送到输入框:`composerInsertRef.current?.(全文)`(kernel 公共面,files/academy 同先例)。
- 就此追问:`host.createSession` spawn 新会话并 `writeSession` 注入「文档全文 + 追问引导」;不做文档↔会话强关联(v1)。

## UI 与组件拆分(300 行铁则预分)

- **项目详情概要页入口**(截图点位):`wb-info-actions` 的「生成文档」标签 + 5 个固定类型按钮组收敛为单个「生成文档…」按钮 —— 类型选择进弹窗(模板库含自定义,固定按钮装不下增长面);此入口打开 `DocGenDialog` 时**预锁范围=单项目·本项目**(范围 seg 隐藏,弹窗显示锁定 chip,周期/模板/事实源/引擎照选),产物标题与记录自动带项目名。旁加「本项目生成记录 →」文字链接跳工作台「文档」页签(tab payload 带 `docgenProjectFilter`,列表过滤本项目)。抽屉「文档」页签(DrawerDocsTab)保持用户资料文档语义不变;「存为项目文档」产物落那里,与生成记录物理分档。项目抽屉内嵌完整阅读器(过滤单项目视图)留 P3 后评估,本期不做。
- `WB_TAB_ITEMS` 加 `{ key: "docgen", label: "文档" }`;`WorkbenchTab` 路由到 `docgen/DocGenScreen.tsx`(列表+阅读器双栏)。
- docgen/ 子域文件:`DocGenDialog.tsx`(配置弹窗)、`DocGenScreen.tsx`(壳)、`DocList.tsx`、`DocReader.tsx`(状态驱动三视图容器)、`ReaderStructured.tsx`、`ReaderDiff.tsx`、`parse.ts`、`assemble.ts`(prompt 组装)、`genSession.ts`、`docgenQueue.ts`、`templates.ts`(内置模板)、`store.ts`(docgen.json 读写,subscribe 面)——每文件单一职责,<300 行。
- 词典:全部走 `t()` 中文键,en/ja 补齐;`DOC_GEN_MARK` 等常量不进词典。
- 空态:无产物时列表区引导文案 + 「生成文档」主按钮(沿 `wb-empty` 形制)。

## 架构合规

- 全部改动面 = `src/plugins/workbench/`(docgen 子域 + `wbTabs.ts` 一行 + `OverlayActions`/`ProjectDetail` 入口改造);kernel 零改动(`composerInsertRef`/`fileEditDetected`/`openDiskSession` 均既有公共面);Rust 零改动。
- journal 子域复用为同插件 import(sessionDigest/genSession 生命周期语义),无跨插件契约新增,不涉 cli-shared 准入。
- 退役:`DocPreviewDialog.tsx` 删除,`docRequests()` 中 analysis 项并入模板库。

## 分期

1. **P1 生成闭环**:模板库+配置弹窗+prompt 组装+spawn 生成+docgen.json 落盘+「文档」页签列表与原文阅读+复制/导出+失败重试;DocPreviewDialog 退役。验收:真机无头单发一份周报落盘可读。
2. **P2 结构化与回写**:骨架解析+三视图+溯源跳转+转任务+版本链与对比。验收:解析失败回落不白屏;转任务带源落对项目。
3. **P3 排程与分发**:定时排程+对账+存为项目文档+发送输入框+就此追问+自定义模板管理。验收:排程错过窗口标已错过;四条分发路径各自可达。

## 验证

- 每期收口:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `npx react-doctor@latest -y` 100 分。
- UI 行为改动 `pnpm tauri:dev` 真机目检;生成链路以 1421 桩目检(桩 `session_spawn`/`fs_*`/`plugin:event|listen` 配方见项目记忆)+ 真机一次无头单发实证。
- 回归锚点:journal 既有测试不动;`OverlayActions`/`ProjectDetail` 改造后其测试同步迁移;新增 docgenQueue/parse/assemble 纯函数测试。

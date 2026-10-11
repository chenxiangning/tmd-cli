# 22 · 生成文档流水线(docgen)已落地契约

- 日期:2026-10-12
- 状态:已落地(P1 生成闭环 + P2 结构化回写 + 每周排程;P3 留后)
- 设计 spec:`docs/superpowers/specs/2026-10-11-docgen-loop-design.md`(含方案取舍,本文只记契约)

## 定位

工作台「文档」页签 = AI 文档流水线:配置(模板库 × 事实源 × 周期)→ 真实 CLI 会话无头单发生成 → markdown 落盘即结算 → 结构化解析(溯源/对比)→ 落地分发(转任务/存项目文档/发送输入框/就此追问)。是 journal 生成生命线的姊妹实现,同插件内复用其原语,不新增内核机制。

## 数据布局(单一权威)

```
~/.tmd-cli/workbench/docgen/
  docgen.json                  # 索引:entries(轻元数据)+ schedule + tasks(队列截尾 50)
  docs/<entryId>/v<N>.md       # 版本链实体(生成会话直写;文件出现 = 结算信号)
  docs/<entryId>/prompt-latest.md  # 本次生成 prompt(@file 传入引擎,每次重写)
```

与项目资料文档(`docs/project-<id>/`)物理分档:流水线产物不混用户资产;docgen.json 不进 workbench index.json(AI 会话按 AI-TASKS.md 直改 index,流水线元数据混入会被误伤)。

## 生成生命线(docgen/genSession.ts,复刻 journal runGeneration 段式)

1. 入队前定版号 `v = versions.length + 1`,结算目标文件 = `docs/<id>/v<N>.md`;
2. prompt = 严格五段骨架契约(概览/项目进展/风险与阻塞/行动项/建议,parse.ts 是唯一解析器,契约改动两侧同改)+ 事实源四路(项目摘要 `projectBrief` 恒选;工作日志文章/会话摘录 `sessionDigest`/Git 提交 `ipc.gitLog` 可选)+ 受众语气段 + 附加指令;prompt 头带 `[DOC-GEN]` 自指标记(会话清单过滤);
3. spawn:引擎声明 `oneshotArgs` 走无头单发(@file),`oneshotStdin` 走 stdin 注入,否则回落 TUI 写入(1.2s 冷启动窗 + 9s/15s 双保险 CR);
4. 结算三路:fileEditDetected 命中 v<N>.md / 15s 轮询兜底(omp/pi 系无 editMarks)/ 12 分 SETTLE 超时;命中后 8s 容忍窗再结算;队列层另有 20 分 RUN 硬顶;
5. 成功 = `settleEntry`(版本落账 v/at/engine,状态 done,docState=draft);失败 = `failEntry`(error 落档,行上重试/换引擎重试);取消/终止 = `terminateEntry`(有历史版本回 done,首版未产出整条移除)。

## 队列与排程

- `docgen/queue.ts`:3 槽并发 + 20 分硬顶 + 30s 审计 + 维度键(模板×范围×周期)活跃去重(防两个 agent 写同一 v<N>);run 态取消经 abortRun 收割会话并 terminateEntry;启动恢复 run→err「中断」,queue 续跑;任务持久化经 `persistQueueTasks` → docgen.json tasks。
- `docgen/schedule.ts`:每周 weekday HH:MM,幂等闸 = schedule.lastWeekKey(持久);15 分钟对表 + boot 补跑(journalSchedule 先例);配置存 docgen.json,弹窗可开,文档中心排程卡可暂停/恢复。

## 结构化契约(docgen/parse.ts)

- 五段二级标题缺一或风险/行动双空 → 整体回落 MarkdownBody;
- 风险行 `- 高:文本 <!--src:出处-->`;行动项 `- [ ] 文本(负责人:X,截止:D) <!--src:-->`;建议 + 缩进 `依据:`;项目进展内 `### 项目名` 分块;
- 对比 = 相邻两版条目级 diff,键 = 字母骨架(数字全剔,activityWatch 同款):add/del/mod。

## UI 面与入口

- 「文档」页签(WbTab `docs`)= `DocGenCenter`(排程卡 + 今天/更早分组列表 + 状态驱动阅读器);阅读器三视图(结构化/对比/原文)+ 版本 pills + 分发动作条;
- 顶栏「生成文档」单按钮 → `DocGenDialog`(analysis 模板 = 纯提示词复制不 spawn,保留原 DocPreviewDialog 语义;DocPreviewDialog 已退役删除,`buildDocDraft/docKinds` 一并清除);
- 项目详情概要页:旧 5 固定类型按钮 → 「生成文档…」(预锁单项目)+「本项目生成记录 →」深链(payload `{tab:"docs", projectFilter}`)。

## 铁则对照

- 全部代码在 workbench 插件内(`src/plugins/workbench/docgen/` + `docgenView.ts`),kernel 零改动;纯函数在 .ts(react-doctor only-export-components);
- 单文件 ≤300 行;通用原语只碰 `ipc.gitLog / fsReadFile / fsWriteFile / ensureParentDir / host.createSession / writeSession / removeSession / composerInsertRef`;
- 转任务 = `addTask(projectId, TaskInit)`,description 落来源;全部项目范围缺标注落第一个「进行中」项目并 toast 说明;存项目文档 = `createDoc`。

## 验证记录(2026-10-12)

- 单测 20 例(parse/queue/schedule/templates)全绿;全仓 3897 用例通过;typecheck/arch-boundary/file-size/build 通过;react-doctor 100;
- 1421 桩目检闭环:弹窗配置 → 入队(omp 无头)→ prompt 落盘 → 桩产物 v1.md → 轮询「已检测到文档写入,结算中…」→「完成 v1」→ 结构化五段(风险高/溯源徽/行动项/建议)渲染;转任务空项目守卫 toast 正常。

## 真实机回归补记(2026-10-12 用户实测后查漏)

- **ENOENT 根因**:`writeDocGenIndex` 曾把目录 `docgen/` 传给 `ensureParentDir`(只建到 workbench),真实 fs 写 index 报「写入文件失败: os error 2」——桩环境的 JS map 建模不了真实目录层级,目检拦不住。铁则:**目录路径必须 `ensureDir(目录)`,文件路径才 `ensureParentDir(文件)`**,两者不可混用。
- 查漏补齐(对照 spec):溯源三路真跳转(进展→项目页签 focusTab / 日志→openArticleTab / 会话→标题匹配 openDiskSession,全部项目范围与无匹配 toast 说明)、状态机第三态「已归档」循环、转任务重进防重(按 task.title=条目文本前 80 字从工作台快照派生,替代内存置位)、prompt 语言段(跟随 i18n locale)、collectSessionsMd 全程降级不拦生成、弹窗单项目空列表守卫、失败卡「查看残留输出」与周期自定义区间明确 P3(spec 已注记)。

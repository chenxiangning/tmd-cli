# 15 — CLI 学堂(cli-academy)契约

日期:2026-09-25 · 状态:已落地(阶段 1-3;多 CLI 接入面随 claude/codex/pi 供给扩展)

## 定位

多 CLI 通用的引导学习体系:kernel 课程注册面(契约)+ 各 cli-* 插件供给课程数据 + `academy` feature 插件消费渲染。kernel 零 CLI 私有知识;新增一个 CLI 的学堂 = 该 cli-* 插件注册一份 `AcademyCourse`,学堂 UI 零改动。

## 契约

### 数据(kernel/academy.ts)

- `AcademyCourse { cliId, title, sourceVersion, chapters, lessons, openPanel? }`;
  `cliId` 对齐 `CliProfile.id`;`sourceVersion` = 数据提取时的源 CLI 版本(升级重提时更新)。
- `AcademyCommand { name, zh, detail, examples: {sc,i,o,e}[], subs?, how?, usage?, en? }`:
  zh 一句话定位;detail 讲「为什么需要它」;示例四段 = 场景/输入/回显/预期。
- `AcademyLesson { id, title, sub, goal, points, chapter?, demo?, practice?, practiceWhy?, cheat? }`:
  `chapter` 指向 chapters[].id(指南「去学」互链);`cheat` = 结业速查课;demo 命令必须存在于目录。
- 注册表同 sidebarActions 纪律:`registerAcademyCourse`(cliId 重复抛错)/`removeAcademyCourse`(幂等)/`getAcademyCourse(s)`/`subscribeAcademyCourses`/`useAcademyCourses`;
  ctx 通道 `ctx.registerAcademyCourse`;contributionLedger 记账撤销(activate 失败/熔断逆序回滚)。

### 供给方职责(cli-*)

- 数据放 `src/plugins/<cli>/academy/`,TS 数据总表(头注注明真源与提取版本;omp = 18.3.1 `BUILTIN_SLASH_COMMANDS_INTERNAL` bun 直读)。
- activate 内 `ctx.registerAcademyCourse(...)`;可从目录派生 composer 静态候选(omp 先例:pinned 幕布语义条 + 目录派生,描述 = zh 一句话)。
- `openPanel` 仅在存在真实程序化打开函数时声明(徽章按钮),杜绝假按钮;v1 omp 未声明。

### 消费方(academy 插件)

- 挂点:`leftSidebar.section`(order -1,左栏顶部入口;无课程渲染 null)/`overlay`(order 45,入门课向导)/`registerTabContent("academy.guide")`(指南 tab,payload `{cliId}`,tab id `academy:<cliId>`)。
- 进度:localStorage `tmd.academy.progress.v1`,按 cliId 分桶 `{done: lessonId[], cur}`;快照引用稳定(缺省桶 EMPTY 常量,useSyncExternalStore 约束);仅首次完成推进 cur。
- 练习「试一试」:`composerInsertRef` 插命令 + rAF 后 `composerWakeRef("/")`(同帧连调会被 composer 非函数式 setValue 陈旧闭包覆盖——审查 P1 实证);无 composer 挂载时静默跳过。
- 课点富文本:数据侧仅允许 `<b>`;渲染 esc 全量后放行 `<b>`(lessonPointHtml)。
- CSS 全 token(`--tmd-*`),类名 `academy-` 前缀;reduced-motion 关停打字光标。

### 契约测试

- `tabContent.contract.test.ts`:OPENABLE_KINDS 含 `academy.guide`(双向锁定);全量激活 ctx 桩含 `registerAcademyCourse`(no-op,重复 activate 防重复注册)。
- 目录不变量(cli-omp/academy/academyCatalog.test.ts):章节命令唯一、示例四段齐、lessons 与目录互链、候选派生并集语义(pinned 3 条 action:send 保留)。


### 排版铁律(2026-09-26 大仙复审补)

- 学堂字号一律 **rem**(锚 = html 根字号),禁 px 硬编码;三个根容器(`.academy-entry`/`.academy-guide`/`.academy-wizard`)设 `font-size: 0.75rem` 基线,全树继承——`settings.uiFontSize`(外观设置,12-20)一改即随客户端整体缩放。
- `button`/`input` 必须 `font: inherit; color: inherit`,且**以 `:where(...)` 包裹压零特异性**(UA 默认 16px 不继承 body、`buttontext` 色在深色主题不可见;直接写类选择器会以 (0,1,1) 压死后置类级 color/font-size 声明——特异性倒挂是实测回归)。颜色一律 `--tmd-*` token,浅深主题自动跟随,禁裸色(box-shadow 裸黑为仓库公认例外,open-with/cli-config 先例)。

## 二期(未做)

en/ja 词典;composer 抽屉详情卡;openPanel 徽章;claude/codex/pi 课程(pi 已接入 0.84.1,54bed23;claude/codex 待);课程版本失效提示(sourceVersion vs 探针版本)。

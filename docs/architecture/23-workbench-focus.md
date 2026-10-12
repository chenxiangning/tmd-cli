# 23 · 工作台聚焦页(三撤一合)已落地契约

- 日期:2026-10-12
- 状态:已落地(门禁全绿 + 1421 桩目检双态)
- 设计 spec:`docs/superpowers/specs/2026-10-12-workbench-focus-view-design.md`(含方案取舍,本文只记契约)

## 页签面(7 → 5)

`WB_TAB_ITEMS`(wbTabs.ts):概览 / **聚焦** / 任务看板 / 文档 / 工作日志。原项目列表 / 时间线 / 待跟进三页签已删除,数据 100% 重表达(见下),零数据丢失。

## 聚焦页三段(screens/FocusScreen.tsx + 纯数据层 focusModel.ts)

1. **要处理**:复用 followUpBuckets 三桶(已逾期 / 今天到期 / 本周)为**单流分组列表**——空桶整组不渲染,组头(风险色 + 计数)只在有行时出现;更晚 + 未排期折叠单行,行数徽标,点击就地展开,行几何与三桶行一致。行内操作:勾完成、项目 chip、关联会话徽标(点击直达/恢复会话)、推进钮、删除钮(确认弹层)。
2. **接下来 14 天**:**只有事日渲染**为紧凑 chip(「今天 — 任务 ×1」「10/13 二 [项目名]」),空日不占位,flex-wrap 横排;DDL chip 风险色点击开详情,任务计数徽标悬停 title 见明细;全空落一行「未来 14 天没有到期事项。」。禁任务卡堆叠,点击不过滤第一区(防双重位移)。
3. **项目脉搏**:被跟踪行按最近活动倒序(活动 = 会话链 / 文档 / 进展三源取最新,`focusModel.latestActivity`);被跟踪判定 = 有未完成任务 | 有 DDL | 近 7 天有活动,否则进空壳折叠索引(字母序 chip 墙 + 过滤框并入折叠条,点击开详情)。行布局为 **grid 定列** `150px auto auto auto minmax(0,1fr) auto`(名/风险/截止/未完/活动/操作六列逐行对位;≤860px 容器回落 flex 换行);「开会话」钮(无 cwd 禁用,复用 `sessionOpen.createSessionHere`)。

**清净态一等公民**:focusLine(结论行)= 逾期数 / 今天到期 / 活跃项目数 / 最热项目名;三桶全空时「要处理」区升级为 hero 卡(本周剩余 DDL / 活跃项目计数 + 「去任务看板」「新建任务」双动作)。「新建任务」经 `boardFormOpen` 一次性布尔切看板并展开表单(挂载即消费,显式切页签复位,不持久)。

## 连带裁撤

- 概览页下线「模块负载 / 负责人负载」两死轴图(真实数据模块/负责人全集中,「其他项目 + 大仙」恒 100%),保留风险环 + 进度直方图 + KPI 条。
- 删 charts.tsx 的 ModuleLoadBars / OwnerRankBars、insights.ts 的 moduleWorkload / ownerWorkload / MODULE_ACCENTS、calendarTimeline.ts 的 timelineModel(时间线随页签整撤),wb-tl-\* 样式同步删。

## 复用纪律

followUpBuckets 行项扩展 status / sessions 字段(聚焦页与看板复选条共用,不平行造桶);「开会话」收敛进 sessionOpen.ts 的 `createSessionHere`(ProjectDetail 概览主动作与聚焦脉搏行共用一处);`WbSessionActs` 直接复用为行内会话直达徽标。日期短格式 `dayShortOf / weekdayShortOf` 进 journal/dateTitle(本地化单点)。

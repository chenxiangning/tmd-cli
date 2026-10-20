# 24 小时提交窗口评审(2026-10-20)

- 日期:2026-10-20
- 状态:已收口(发现项当日修复,验证链全绿)
- 窗口:`ff89f32d…1d53fc9e` 共 30 笔;深审增量 = `26bfee91` + `312bd056` + `1d53fc9e`

## 覆盖口径

24h 内其余 27 笔各带既有评审,不重复全审:追加批六项(6c7ed669/e6c52e57/dab66862/7ed2af76/ce547cf1/c33164f6)批内逐批 review(2026-10-19-042-followup);0.4.0 发版链经二轮评审收口(ff89f32d)+ 发版文档复核(aa539792/c944cc2d);footprint 主链(264b2a2e…32474293 + PR 72/73/74)随 architecture/30 沉淀与发版评审覆盖;7227b4cf/7701fb7f/64393168 为小修自带验证。

本轮深审对象 = 发版文档之后未过任何评审的三笔:

1. `26bfee91` footprint 视图 v2 原型校准打磨(并行会话);
2. `312bd056` 工作日志 × 每日足迹双向深链 + 视图打磨批合并收口(双会话交缠批,大仙拍板合并提交);
3. `1d53fc9e` daily-journal.css 上移 attach 装配点(大仙真机报缺样式回归修)。

## 发现与处置

| 级别 | 发现 | 处置 |
|---|---|---|
| minor | `docs/architecture/30-footprint.md` 准入清单缺 `genRequest` —— 打磨批新增 footprint(useFpAiDigest)→ journal(genRequest) 出向边,文档未随批更新(跨会话合并批的典型漂移) | 当日修:清单补 genRequest 及消费面注记(随本 review 提交) |
| nit | `fpTab.fpInitView` 的 `?? { y: 1970, m: 1 }` 兜底分支不可达(today 恒 dayKeyOf 产物) | 豁免留痕:防御性存在,注释已声明 |
| nit | `fpYmOfDay` 接受月日出界日(如 02-30,不做日历校验) | 豁免留痕:深链生产者恒内部模块,格式可信;测试注明宽松容错口径 |

## 深审核对项(通过)

- **接缝完整性**:26bfee91 的 anchor state 化/抽屉按需/修正菜单定位 与 312bd056 的深链钩子化(useFpDeepLink/useFpSelection/useFpAiDigest)在 FootprintView 交缠改写后无语义冲突;typecheck + 163 用例 + doctor 100 三链证实。
- **深链格式契约**:journal day key(`${y}-${pad2(m)}-${pad2(d)}`)与 footprint `dayKeyOf` 零填充格式一致;`openFootprintTab()` 无参刷新 payload 为 `{}` 时视图不跳日(幂等)。
- **digest 删除无断粮**:⌘K 搜索侧(query.ts:220-222)自经 `dailyPaths()` 读 article/digest,与当日视图 `loadDayDetail` 的 digest 移除互不影响;`journalPath("digest")` 旧入口零残留(编译期证实)。
- **CSS 装配点**:域样式上移 attach 后,深链直开/主视图/轴视图三面全覆盖(1421 桩回归目检:`.dj-` 样式表在全新加载的直开文章 tab 在场);loss = 非 workbench 场景多载一份几 KB 域 CSS(workbench 为常驻核心插件,可接受)。
- **react-doctor 100 收口路径**:render 期 setState 比较块出仓 .ts 钩子(先例 useArticleEditSignal 同款);忙守卫 ref 化;复杂度减法顺序 = 抽钩子不动 JSX 语义。
- **边界规则**:新跨插件边(journal→fpTab 反向导航、footprint→journalTabs/genRequest 数据)均无模块环(fpTab 仅依赖 kernel + dataSource 纯函数;journal 叶子模块不回指上层);check:arch-boundary 绿。

## 验证链

- `pnpm check:gate` 全链绿(两轮:typecheck/test/架构边界/300 行/i18n 键比对/kernel 盘点/build + check-dist);
- `npx react-doctor` 100(初扫 84,抽钩子后达标);
- vitest footprint+journal 163 用例全绿(含新增 fpTab 契约 4 例、FlowView 深链入口回归、DayFlow loading、genRequest);
- 1421 桩目检:深链直达/打开日报 tab/轴视图足迹钮/payload 换日跟跳往返/CSS 直开回归五段。

## 遗留

- `footprint/index.tsx`、`view/useFpData.ts` 有并行会话在途改动,未纳入本窗口评审(未提交不审,等其收口另查)。
- 推送前按铁则在最新树重跑 `pnpm check:gate`。

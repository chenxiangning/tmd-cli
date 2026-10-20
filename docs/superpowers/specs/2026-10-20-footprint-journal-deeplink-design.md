# 每日足迹 × 工作日志双向深链设计

- 日期:2026-10-20
- 状态:已落地(2026-10-20 随批提交;方向 = 联动分析页 20261020 B 面板)
- 前序:`docs/superpowers/specs/2026-10-19-footprint-design.md`、`docs/architecture/30-footprint.md`

## 背景与目标

footprint 数据层已与 journal 深度联动(L2 同源会话行 / L3 管线 A 生成会话直写功能卡 / ⌘K 收录日报与摘录 / 抽屉 resume 走 sessionRef),但界面层零互跳:

- journal 侧(月历/轴视图)没有「看足迹」入口:`openFootprintTab` 全仓仅足迹侧栏一处调用;
- footprint 日视图没有「打开日报」入口:`openArticleTab` 未被 footprint 引用;
- 死载荷:`loadDayDetail` 拉 `article`/`digest` 文本进 `FpDayDetail`,视图层零消费,点日白读两个文件。

目标:补双向 tab 深链,顺手消死载荷(接上消费,不删功能)。

## 方案

选定(全部零新 Rust、零新 IPC):

1. **fpTab payload 深链**:`openFootprintTab(opts?: { day?: string })`(day = `YYYY-MM-DD` 零填充,与 `dayKeyOf` 同格式),内部 `openTab(..., { refresh: true })` —— 已开 tab 刷 payload 并激活(契约 `kernel/tabs.ts` refresh opt-in 深链重开场景);新开则按 payload 初始化。`FootprintView` 改收 `{ tab }`(EditorCenter 既有注入,先例 BatchSheet/FileTab),mount 期 `payload.day` 进 useState 初始值;已挂期 render 期 payload 比较驱动跳日(`useArticleEditSignal` 的 lastPayload 先例),跳日动作 = 退出区间态 + `setSel` + 清卡片/文件选中/焦点(与 selectDay 普通路径同款)。
2. **journal 侧入口**:`FlowView` DayCard 头部「全文 ↗」旁加「足迹 ↗」钮(`openFootprintTab({ day: day.key })`)。月历格不加:格点击语义已归文章,双钮 clutter。
3. **footprint 侧入口 + 死载荷消费**:`DayFlow` 日模式汇总 chips 下加「日报」行(`detail.article` 存在时渲染):首行标题 + 「打开日报 ↗」(`openArticleTab(y,m,d,首行标题)`);`detail.digest` 视图层确无消费面(原话锚点实际来自 features JSON,搜索另读文件),自 `FpDayDetail` 删除该字段与加载(干净切换,不留半死字段)。
4. **跨包 import**(登记进 `docs/architecture/30-footprint.md` 准入清单):
   - journal → `@plugins/footprint/fpTab`(新增反向边;fpTab 仅依赖 kernel,i18n/tabs + dataSource 的 `dayKeyOf`;`daySessions`/`journalFiles`/`sessionRef` 是叶子模块不回指 journal 上层,无模块环);
   - footprint → `@plugins/workbench/journal/journalTabs`(同向追加,openArticleTab 深链契约齐备)。

### 被否方案

| 被否 | 理由 |
|---|---|
| journal 日视图嵌足迹量化条 | 需 journal 读 rollup 磁盘格式或 footprint query 层,依赖倒转成双向数据耦合,收益只是重复展示一层摘要 |
| 两面合一(月历合并进工作日志) | 口径不同:journal 记记录存在性/待生成,footprint 记净增热力;v2.1 原型已定独立中央 tab |
| `dayKeyOf` 搬 `types.ts` 解耦 | 实测无模块环,5 文件 churn 不值;若未来 fpTab 反向边出问题再搬 |
| footprint 无卡日加「去生成日报」钮 | 本 spec 初稿裁决 YAGNI;同日并行打磨批以 `requestDayGenerate` 桥落地(FallbackList「AI 补归纳」,入队工作台日报生成会话,功能卡随文直写),以代码为准,此项撤出被否清单 |

## 验证

1. vitest:`fpTab.test.ts`(缺省开今日 payload `{}` / 带 day / 已开时 refresh 刷 payload);
2. 1421 桩目检:足迹日视图「打开日报 ↗」开对日文章 tab;journal 轴视图「足迹 ↗」开足迹 tab 且停对日;已开足迹 tab 时二次深链 payload 变更跟跳;
3. `pnpm check:gate` 全链绿 + `npx react-doctor` 100。

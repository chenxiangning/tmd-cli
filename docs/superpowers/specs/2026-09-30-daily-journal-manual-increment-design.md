# daily-journal 手动发起总结/增量更新入口

日期:2026-09-30
状态:已定稿(用户拍板方案 A:文章 tab + 月格全状态覆盖)

## 背景与目标

当日文章一经生成,后续新增会话(如 9 月 30 日实测:已归纳 5 · 待归纳 38)没有任何手动发起增量归纳的入口:

1. 文章 tab(ArticleTab)顶栏只有状态 chip 与生成会话条(仅「打开会话(可干涉)」),当日会话区的「已归纳/待归纳」计数纯展示、不可点;
2. 月视图日格按钮 `canGen = st === "p" || st === "f"`,有文章的日子(st 为 t/g)按钮消失;
3. 与 GenSettings「手动确认」档文案直接矛盾——文案承诺「当日文章只在你主动点生成时更新」,实际有文章的日子无处可点。自动路径(incPolicy=auto)只在会话退出后 45s 触发一次,错过即无解。

生成执行体(runGeneration)已完整支持增量:有文章时 prompt 走「逐字保留既有节,仅把(新增)会话并入成新节」,任务类型「增量并入」已存在。**纯 UI 入口缺失。**

目标:任一有会话的日子都能手动发起生成——无文章首生成、失败重试、有文章增量并入,文章 tab 与月格两处入口语义一致。

## 方案取舍

**选定(方案 A):文章 tab 顶栏动作按钮 + 月格全状态扩展,两处共用一套判定。**

- 文章 tab 顶栏(`dj-art-bar`)右侧常驻一个状态自适应按钮:
  - 同日已有排队/运行任务 → 禁用态「生成任务进行中」;
  - 有文章且无待归纳行(或全然无会话)→ 不渲染;
  - 有文章有待归纳 → 「增量并入 · 待归纳 N」;无文章有会话 → 「生成此日」;失败 → 「重试生成」。
  - 两击确认(仓内「再点一次确认」同款,3s 武装窗),入队后按钮自行翻转到禁用态。
- 月格 `canGen` 扩展出「有文章且存在待归纳行」形态,按钮文案「增量并入」,入队/确认与现有 p/f 形态同款。

理由:生成是有 token 成本的真实 CLI 会话,入口要贴着「用户正在看哪天」走——文章 tab 是审视一天的场所,月格是扫月补漏的场所,单做一处都会让另一处的语义缺口留存;且两处复用同一判定函数,不产生第二套真相。

**否决(方案 B):仅文章 tab 且仅今日。** 改动最小,但往日文章补录会话(g 日待归纳)依旧无入口,月格与 GenSettings 文案的矛盾原样留存。

**否决(方案 C):按钮放「当日会话」小节标题旁。** 与待归纳计数语义最近,但顶栏无入口、月格不动,发现性最弱;且该小节在无文章日不渲染,首生成场景覆盖不到。

## 设计

### 判定与入队(纯函数,测试面)

- `taskQueue.ts` 新增:
  - `dayGenTaskType(failed, hasArticle)`:失败 → 重试生成;有文章 → 增量并入;否则 → 手动生成(类型与自动路径命名对齐,任务面板/珠子文案自动一致);
  - `hasActiveTaskForDay(dayKey)`:同日跨类型活跃闸——`enqueueTask` 只按 (日, 类型) 去重,不挡「手动生成 + 增量并入」并发写同一篇文章,必须在日粒度拦截。
- `statusText.ts` 新增 `dayGenAction(st, hasArticle, pendingCount, busy)`:返回 `none / busy / confirm+label` 三态,文章 tab 与月格共享同一状态矩阵,文案集中一处。

### 消费点

- `ArticleTab.tsx`:顶栏右侧 `GenAction` 组件(订阅 `useGenTasks` 出禁用态);待归纳计数 = 行级 `isRowSummarized(r, meta.summarizedAt)` 取反计数(水位未定 = 全部待归纳,维持既有语义)。
- `MonthView.tsx`:`canGen` 扩展 + `quickGen` 改经 `hasActiveTaskForDay` 闸与 `dayGenTaskType` 定型;重复点击 toast 文案改「该日已有生成任务在队列」(原「同类」在跨类型闸下失真)。
- `GenSettings.tsx`:「手动确认」档说明补上文章 tab 入口,消除文案与事实的矛盾。

### 不做

- 不动生成执行体、prompt 契约、结算链与调度(定时/补跑/auto 增量原样);
- 不做「整篇重生成」语义(增量 prompt 本就保留既有节,重生成是另一需求);
- 不给月格订阅任务 store(整月重渲染代价换不来价值,入队 null 走 toast 兜底)。

## 验证

- 单测:`dayGenAction` 三态矩阵(新 statusText.test.ts)、`dayGenTaskType`/`hasActiveTaskForDay`(taskQueue.test.ts 扩展)、月格增量按钮渲染(MonthView.test.tsx 扩展:有文章+待归纳日出「增量并入」,无新增日不出)。
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build` + `npx react-doctor@latest -y` 100 分。
- 真机:`pnpm tauri:dev` 目检——今日文章 tab 出「增量并入 · 待归纳 N」,两击后任务面板可见「增量并入」,生成会话条点亮「打开会话(可干涉)」;完成后待归纳计数收敛、按钮消失。

## 落地补记(同日真机首踩)

用户真机点按后任务永卡「排队中」。根因非生成链:手动入口是第一个从组件模块直触 taskQueue 的按钮,恰逢 taskQueue.ts 热更,vite 组件边界热更把改动链上的 taskQueue/journalStore 重造为无泵执行体、无持久化绑定的镜像实例——任务进镜像 store 永不起跑,meta.json 无痕(实证)。修复:taskQueue.ts / journalStore.ts 加 `import.meta.hot.accept(() => location.reload())` 自接受守卫,凡这两个文件被改一律整页重载、全图重新接线;月格「生成此日」的同类潜伏暴露面一并根除。生成调度链(journalSchedule→genSession)只被非组件模块引用,本就走整页重载,无需守卫。

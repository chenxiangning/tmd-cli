# 首页 token 用量 dashboard 设计

- 日期:2026-09-11
- 状态:已落地(2026-09-11 当日实施;方案 B + 大仙追加裁定:零消耗引擎整行隐藏、量值标在柱尖)

## 背景与目标

首页(欢迎页)目前为「终端窗体 + 全动作行」结构,引擎用量、配额水位、续作上下文已全部在窗体内呈现,唯独**首页底部红框位尚为空带**。用户日常最关心的「这周花了多少 token / 哪个引擎最贵 / 哪天最猛」没有可扫的入口——QUOTA 显的是供应商套餐水位(剩余额度),不是消费事实。

目标:把红框空带填成「按引擎用量 + 近 7 日趋势」的本地消费 dashboard,纯本地数据(各 CLI 会话 JSONL),零网络请求,展示本机近 7 日消费事实。

## 方案取舍

- **选定:B 引擎用量行 + 近 7 日趋势双列** —— 复用 QUOTA 行语言(`9rem / 1fr / 4.5rem / 2.5rem`),信息密度与页脚同档,346 px 红框高度刚好装下,无新视觉范式。
- 否决 A 单行统计条:零图表,看不出分布与趋势;用户拍桌问「昨天花了多少」时一眼找不到。
- 否决 C 完整 dashboard(模型细分 / Top 会话 / 30 日):红框装不下,扫描成本高,数据源代价不成比例;Top 会话榜留作二期候选。
- 数据源实盘验证(2026-09-11):
  - claude:`input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens` 行型可用。
  - omp/pi:同族 `input / output / cacheRead / cacheWrite / totalTokens / cost.total`,合并一个解析器。
  - codex:`event_msg/token_count` 累计快照,**取会话末次**(非累加,否则翻倍)。
  - kimi:`~/.kimi` 无 sessions 目录(仅 config/logs),行型未探 → 显 `—`。
  - grok / qoder / opencode:行型未实现 → 显 `—`。
- 视觉铁律:颜色零硬编码,全消费 `--tmd-*` token(ok→`--tmd-ok`、faint→`--tmd-fg-faint`、border→`--tmd-border`、warn→`--tmd-warn`、err→`--tmd-err`、fg→`--tmd-fg`);字号走全局 rem 链,继承 `--spacing:4px`;`pt-2rem` / `0.6875rem` 与 welcome-footer 同档。

## 设计

### 组件与数据流(全部在 `src/plugins/welcome/`,内核/Rust 零改动)

- `WelcomePage.tsx`(装配):状态新增 `tokens: TokenAgg | null`(null = 加载中)+ 副作用 `useEffect` 拉取,挂载即发起(与 RESUME 同模式)。
- `TokenDashboard.tsx`(新):接收 `tokens: TokenAgg | null`,渲染 .tokens 块。空态(无任何数据)= 显「近 7 日无消费」一行;部分数据(只有部分引擎有 usage)= 已聚合的引擎正常渲染,缺数据引擎显「—」。
- `TokenBars.tsx`(新,左列引擎用量):行结构 `9rem / 1fr / 4.5rem / 2.5rem`(与 QUOTA 行同);`bar` 元素绝对定位双层(in 占满条高度 100%,out 贴底 35% 高、宽度=out 比);引擎名 `<span class="nm">` 配 `overflow:hidden + text-overflow:ellipsis` 防截断;图标 1em flex。
- `TokenTrend.tsx`(新,右列趋势):7 根日柱,每柱 `stack`(`position:relative;flex:1;min-height:0`)含 in(100% 宽,高度=当日 tokens / 7 日峰值 × 100%)+ out(底部 35% 高,宽度=当日 out / 当日 in × 100%)双层;底部 11px `lab`(`color: var(--tmd-fg)`),今日 lab `color: #fff; font-weight: 600`(实现时用 `--tmd-fg-strong` 或新增 `--tmd-accent`)。
- `tokens.css`(新,300 行铁则,单文件):只定义 .tokens/.tokens-head/.tokens-stats/.tokens-grid/.trow/.trend/.day/.stack/.in/.out/.lab/.note 等类,绝不篡改 .welcome-*。
- `tokens.ts`(新,数据聚合层,纯函数):`extractUsageFromJsonl(profile, jsonlPath): Promise<SessionUsage>` 与 `aggregateByEngine(profiles, sessions, windowMs): TokenAgg`。type 定义:`SessionUsage { profileId; sessionId; ts; input; output; cacheRead; cacheWrite; cost? }`、`TokenAgg { byEngine: EngineUsage[]; daily: DailyUsage[]; totals: { input; output; cacheRead; cacheWrite; cost } }`、`EngineUsage { profileId; totalIn; totalOut; totalCache; cost? }`、`DailyUsage { dayKey(YYYY-MM-DD); totalIn; totalOut }`。
- 数据获取:
  - 复用 `host.getCliProfiles()` + 各 profile 的 `listSessions(root)`(已有,与 RESUME 共)。
  - 对每个有 modifiedAt > now-7d 的 session:`ipc.fsReadText(jsonl.path, { headBytes: 256 * 1024 })` 取头,逐行 JSON.parse,过滤 `usage` 字段;**仅解析头窗口**(与 extractJsonlTitle 同策略,不读全文,百毫秒级)。
  - 7 日窗口 = `now - 7*86400_000` ~ `now`。按日聚合 by `dayKey(new Date(ts).toISOString().slice(0,10))`。
  - codex 例外:行型是 `event_msg/token_count.total_token_usage`,**取该会话末次**(不累加),ts 取该 token_count 事件 ts;同时记录在注释里为什么不能累加。
  - 无 usage 行型的引擎:在 byEngine 里塞 `{ profileId, totalIn: null, totalOut: null, totalCache: null, hasUsage: false }`,UI 据此显 `—`。
  - 错误处理:任一会话读失败 → 跳过该会话,不阻塞其余(对齐 RESUME 的 `catch(() => [])` 模式);profile 整体失败 → 该引擎 `hasUsage: false`。

### 数据源契约

```ts
// 内核类型(Kernel 出口,cli-shared 消费,单 cli-* 插件实现)
interface SessionUsageLine {
  profileId: string;
  ts: number;       // ms epoch
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: number;    // 仅 omp/pi 有
}
// codex 末次快照特殊形态
interface CodexTokenSnapshot {
  totalIn: number;  // input_tokens
  totalOut: number; // output_tokens + reasoning_output_tokens
  totalCache: number; // cached_input_tokens
  ts: number;
}
```

### 错误处理

- 拉取期失败 → 整个 dashboard 显「用量数据加载失败,点重试」一行 + 重试按钮。
- 部分引擎无 usage → 显 `—`,不噪音(对齐 QUOTA 的"未找到凭据"语义)。
- sessions 0 条 → 显「近 7 日无消费」一行;红框仍有内容,不悬空白带。

### 国际化

locales en/ja welcome.ts 补三键:`用量 = usage / 用量`、`近 7 日 = last 7 days / 過去 7 日`、`近 7 日无消费 = no usage in the last 7 days / 過去 7 日間に利用なし`。dashboard 头部"今日/7 日/消耗会话/pi 系费用"四标签同样三语。

## 验证

1. `pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`。
2. **数据单元测试**(新 `tokens.test.ts`):
   - claude 行解析:行含完整 usage → input/output/cacheRead/cacheWrite 正确提取。
   - omp/pi 行解析:含 cost 字段 → totalIn/totalOut/cost 正确提取。
   - codex 末次快照:3 个 token_count 事件 → 仅取末次。
   - 7 日窗口边界:6.99d 的事件 → 包含;7.01d → 排除。
   - 空 sessions / 部分失败 / 无 usage 引擎 → 聚合返回 null/undefined 字段不抛。
3. **浏览器桩目检**(1421 + Tauri 桩配方):
   - 首页有活跃 tab 时 → 不渲染 dashboard(对齐 WelcomePage "无活跃 session 才挂"的契约)。
   - 无活跃 tab 时 → 红框区出现 dashboard,行 / 趋势 / 标签完整对齐。
   - 桩无任何 cli_* 引擎 → 显「近 7 日无消费」。
   - 桩注入一个带 usage 的 claude 会话 + 一个无 usage 的 kimi → 第一行正常 + kimi 行显 `—`。
   - 截图与原型 v6 视觉比对(颜色 token、栅格、字号、不引入新 `text-[Npx]`)。
4. **变更一致性**:全仓 grep `text-[` 数,确保 dashboard 全部走 rem;grep `--tmd-` 数,确保新文件全部消费 token。

## 未决项(二期候选)

- 窗口周期切换(今日/7 日/30 日)。
- Top 会话榜(单个会话消费排名)。
- 跨工作区 vs 当前工作区切换(默认全工作区,与 RESUME 一致)。
- kimi 行型补完(~/.kimi 是否未来会有 sessions 目录)。
- 跨工作区过滤 UI(目前 fixed 全聚合)。

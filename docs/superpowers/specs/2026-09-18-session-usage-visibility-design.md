# 会话用量可见性:本地 JSONL 提取 token 四元组 + 行徽标 / 详情弹层

日期:2026-09-18
状态:草案(设计推演,未排期 —— 决策依据为同日网络检索的痛点清单,产物含交互原型 `docs/design/session-usage-visibility.html`)

## 背景与目标

网络检索(RedMonk 2025 开发者诉求榜、Claude Code/Codex 官方仓库高频 issue、JetBrains 调查)收敛出开发者对 AI 客户端最在意的能力与 CLI 痛点,其中**「成本/用量可见性」热度第一且官方结构性做不好**:Anthropic 无公开订阅用量 API;prompt cache 失效 bug 让单轮成本静默膨胀 10-20 倍,用户只能自建代理抓包才能发现;多引擎用户(本产品核心人群)更是没有任何统一视图。

机会位:各家 CLI 的 usage 数据**全部落在用户本地磁盘的会话 JSONL 里**,多引擎聚合客户端是唯一能零成本统一解析的角色。tmd-cli 现状:套餐额度面(QuotaChip / welcome 供应商盘点)已领先;会话级用量完全空白 —— session-budget 插件是「会话列表显示条数预算」,与成本语义无关。

目标:

1. 会话列表行 / 会话看板卡显示**该会话累计 token**(如 `1.2M`);
2. 点击徽标弹**用量详情层**:input / cache-read / cache-write / output 四元组、轮次、均值、**cache 命中率**(健康 >80%,受害 <40% —— 社区对 cache bug 的实证阈值,一眼看穿静默膨胀);
3. 首批接入有实证数据格式的引擎:claude / codex / pi / omp;其余引擎显示 `—`,不猜测兜底(既有纪律);
4. kernel 零 CLI 私有知识,格式知识全部下沉 cli-shared / 插件侧。

## 数据实证(2026-09-18 本机采样)

| 引擎 | 字段路径(会话 JSONL) | 粒度 | 自带成本 | 真实样本 |
|---|---|---|---|---|
| claude | 每条 assistant 记录 `message.usage{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens}` | per-turn,**求和** | 无 | `input 87805 / cache_read 768 / output 116` |
| codex | `token_count` 事件 `total_token_usage{input, cached_input, cache_write_input, output, reasoning_output, total_tokens}` | **累计,取末值** | 无 | `input 17060 / output 282 / total 17342` |
| pi / omp | 每条 `message.usage{input, output, cacheRead, cacheWrite, totalTokens, reasoning, cost{...total}}` | per-turn,**求和** | **有(USD)** | `totalTokens 22517, cost.total 0.0074` |
| kimi / qoder / qoder-cn / grok / dsh / opencode | 未核实 | — | — | 首批不接,行内显示 `—` |

注:claude/pi 求和必须全文件流式扫(usage 记录散布全文件,读头/读尾窗都取不到全量);codex 取末值理论上尾读即可,但统一走同一流式通道,不为一家开特例。会话文件 MB 级,逐行流式 parse,不整载内存。

## 方案取舍

### D1 数据口径:token 四元组,不折钱(除自带者)

**选定:input / cache-read / cache-write / output 四元组 + 轮次;pi/omp 额外直接显示自带的 costUsd。其余引擎不折钱。**

理由:折钱需要模型→单价静态定价表,维护地狱且**订阅制下是伪精确** —— Max / Plus / Coding Plan 按限额计费不按 token 计费,折出的美元数误导用户;用户真正要的相对比较(哪个会话烧得多、烧在哪个引擎、cache 是否健康)token 口径完全够。pi/omp 的 cost 是 CLI 自己算的,白拿,显示不背维护责任。

**否决:全引擎定价表折钱。** 被否理由:上表;且研究痛点本源是「限额不透明」而非「单价不明」,折钱答非所问。

### D2 提取层:profile 可选声明 `readSessionUsage` + cli-shared 行型库

**选定:kernel 契约加一个可选声明(与 `readSessionEdits` 同形态),行型知识下沉 `cli-shared/sessionUsage.ts`(先例:`sessionIdentity.ts` 四家行型同居)。**

```ts
// kernel/cliSessionTypes.ts(纯类型,零 CLI 知识)
export interface CliSessionUsage {
  input: number;      // 非缓存输入
  cacheRead: number;
  cacheWrite: number;
  output: number;
  turns: number;      // 携带 usage 的 assistant 轮数
  costUsd?: number;   // 仅自带 cost 的引擎(pi/omp);其余 undefined → UI 显示 —
}

// kernel/cliProfile.ts(可选声明,零知识)
readSessionUsage?: (cwd: string, cliSessionId: string)
  => Promise<CliSessionUsage | null>;
// 文件不存在(懒 flush CLI 首条消息才建文件)→ null;解析不出 usage → null。
```

准入合规:sessionUsage.ts 首批即被 claude/codex/pi/omp 四家 cli 插件消费,远超「≥2 个 cli-* 消费同一磁盘格式」的 cli-shared 准入线;kernel 只见纯类型与可选声明,不违反「内核不理解 CLI 私有格式」。

**否决 A:并入 listSessions 扫描一次性带出。** 被否理由:扫描是轻量高频(每次列表刷新),usage 是重量低频可缓存,生命周期不同;合并会让 N≈2000 会话的全文件读挂进每次刷新。

**否决 B:kernel 侧统一解析。** 被否理由:直接违反 R 铁律(磁盘格式知识必须留插件侧,同 diskSessions.ts 2026-09-04 下沉先例)。

### D3 计算时机:可见性驱动 + (path, size, mtime) 记忆化

**选定:只对「当前渲染的行」计算 —— 侧栏分组分页窗口(useCliSessionGroup limits 既有配额)+ 看板 14 天窗口内的行;结果按 `(path, size, mtime)` 内存缓存。**

- 关闭的会话文件不再变,缓存命中后零成本;
- 活会话(mtime 持续变)在轮次结算 / 会话关闭时重算一次,不做周期轮询;
- 读文件走与 readSessionEdits 相同的磁盘读取通道(插件侧实现,经 ipc 只读原语);
- 首次计算最贵:MB 级文件流式逐行,单文件毫秒级,可见窗口 20-30 行首屏一次性付清,滚动翻页按需付。

**否决 A:启动全量预热。** 被否理由:首开工作区秒级卡顿,N≈2000 × MB 级读全量,为永远看不到的行付费。

**否决 B:落盘缓存(~/.tmd-cli 侧记)。** 被否理由:v1 内存缓存已零成本复用(会话关闭后 mtime 恒定);跨启动冷启动只慢一次。YAGNI,v2 有汇总/趋势需求再上。

### D4 展示面:行徽标 + 点击详情弹层;汇总与告警后置

**选定 v1:三处静态展示 + 一处交互。**

1. 侧栏会话行(`.thread-row` 尾部,时间戳左侧):总计徽标 `1.2M`(格式化:K/M,hover title 展四元组);
2. 看板卡角标:同口径小字;
3. 置顶/运行区行:同 1;
4. 点击徽标 → 用量详情弹层(消费 QuotaChip 弹层的既有定位/样式骨架):
   - 四元组横条(input / cache-read / cache-write / output,按量等宽条形);
   - **cache 命中率** = cacheRead / (cacheRead + cacheWrite + input),>80% 绿 / 40-80% 黄 / <40% 红(社区实证阈值);
   - 轮次数、场均 token、pi/omp 的 `$`;
   - 引擎名 + 快照时间(文件 mtime)。

**v2 后置(本 spec 不承诺):** 看板/侧栏「今日 / 本周各引擎汇总条」;cache 命中率异常行内标警;落盘缓存;未接入引擎的适配器补齐(kimi/qoder/grok/dsh/opencode 需逐一核实落盘格式)。

**否决:v1 直接做汇总面板 + 预算告警。** 被否理由:汇总要求全量预热(与 D3 冲突);告警阈值没有用户校准。先让单会话数字长在行上,汇总等真实使用反馈。

## 改动面预估

- `kernel/cliSessionTypes.ts` + `cliProfile.ts`:类型 + 可选声明(约 30 行);
- `cli-shared/sessionUsage.ts`:四家行型解析 + 流式求和(先例规模参照 sessionIdentity.ts);
- 四家插件各一行声明接线;
- workspace(SessionRows / RunningZone / PinnedSessions)+ session-board(boardRows/boardData):徽标渲染 + 弹层组件;
- 新 CSS 微量(徽标 / 弹层条形)。

## 验证

设计期(本推演):

- 数据格式实证:本机四家真实会话文件采样(上表),非文档推断;
- 交互推演:原型 `docs/design/session-usage-visibility.html` 浏览器目检(浅色主题,三消费面 + 弹层,数据用采样值)。

落地期(若立项):

- vitest:sessionUsage 解析用真实 JSONL 样本行钉行为(claude 求和含多轮 / codex 取末值非求和 / pi cost 透传 / 坏行跳过 / 空会话 null);
- 门禁:`pnpm typecheck && pnpm test && pnpm check:arch-boundary && pnpm check:file-size && pnpm build`;
- 桩目检:1421 dev server + Tauri 桩,侧栏行徽标 / 看板角标 / 弹层三面,未接入引擎行显示 `—`。

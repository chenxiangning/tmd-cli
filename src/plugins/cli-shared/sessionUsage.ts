/**
 * 会话 JSONL 用量行提取(纯函数层,自 welcome/tokens.ts 下沉 cli-shared:
 * session-search(feature)与 welcome(feature)联合消费同一磁盘格式知识)。
 *
 * 行型实盘实证(2026-09-11):
 * - omp/pi:`message.usage` = {input, output, cacheRead, cacheWrite, cost.total},
 *   顶层 timestamp ISO;逐行累加。
 * - claude:`message.usage` = {input_tokens, output_tokens,
 *   cache_creation_input_tokens, cache_read_input_tokens},顶层 timestamp;逐行累加。
 * - codex:`type:"event_msg"` + `payload.type:"token_count"` + `payload.info.total_token_usage`
 *   是**会话累计快照**,只取末次(累加会翻倍)。
 */

const num = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** 单条 usage 行(归一后)。snapshot=true 为会话累计快照(codex 型):
 * 值含历史,速度差分须减前拍;增量型(omp/pi/claude 系)值即本条消息新生成量。 */
export interface UsageLine {
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
  snapshot?: boolean;
}

/** ISO 时间串 → ms;非法 = null。 */
function parseTs(v: unknown): number | null {
  if (typeof v !== "string" || !v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * 单行 JSON → UsageLine | null。三家行型分派:
 * omp/pi 与 claude 走 message.usage(字段名不同),codex 走 event_msg/token_count。
 * codex 返回 { line, snapshot: true } 标记快照语义(调用方只留末次)。
 */
export function parseUsageLine(
  json: unknown,
): { line: UsageLine; snapshot: boolean } | null {
  if (typeof json !== "object" || json === null) return null;
  const o = json as Record<string, unknown>;
  const msg = o.message as Record<string, unknown> | undefined;

  /* omp/pi + claude:message.usage */
  if (msg && typeof msg.usage === "object" && msg.usage !== null) {
    const ts = parseTs(o.timestamp) ?? parseTs(msg.completedAt);
    if (ts === null) return null;
    const u = msg.usage as Record<string, unknown>;
    /* claude 字段名(_tokens 后缀)与 omp/pi 短名并存,两读。 */
    const input = num(u.input_tokens) || num(u.input);
    const output = num(u.output_tokens) || num(u.output);
    if (input === 0 && output === 0) return null; // 全零行(错误行)不产数据
    const costObj = u.cost as Record<string, unknown> | undefined;
    return {
      snapshot: false,
      line: {
        ts,
        input,
        output,
        snapshot: false,
        cacheRead: num(u.cache_read_input_tokens) || num(u.cacheRead),
        cacheWrite: num(u.cache_creation_input_tokens) || num(u.cacheWrite),
        cost: costObj ? num(costObj.total) || undefined : undefined,
      },
    };
  }

  /* codex:event_msg/token_count.info.total_token_usage 累计快照 */
  if (o.type === "event_msg") {
    const p = o.payload as Record<string, unknown> | undefined;
    if (!p || p.type !== "token_count") return null;
    const info = p.info as Record<string, unknown> | undefined;
    const t = info?.total_token_usage as Record<string, unknown> | undefined;
    if (!t) return null;
    const ts = parseTs(o.timestamp);
    if (ts === null) return null;
    const input = num(t.input_tokens);
    const output = num(t.output_tokens) + num(t.reasoning_output_tokens);
    if (input === 0 && output === 0) return null;
    return {
      snapshot: true,
      line: {
        ts,
        input,
        output,
        snapshot: true,
        cacheRead: num(t.cached_input_tokens),
        cacheWrite: num(t.cache_write_input_tokens),
      },
    };
  }

  return null;
}

/**
 * 头窗口文本 → 归一行列表。codex 快照:同会话留 ts 最大的 snapKeep 条(乱序
 * 旧行丢弃,同 ts 后写追加,超量从头截断 → 末位截断后留后写);逐行语义其余
 * 累加由调用方聚合;窗口外(startMs 前)行丢弃。snapKeep 默认 1(汇总口径:
 * 只取末次);速度差分场景传 2(末两拍差分)。
 */
export function extractUsageFromHead(
  head: string,
  startMs: number,
  snapKeep = 1,
): UsageLine[] {
  const lines: UsageLine[] = [];
  const snaps: UsageLine[] = [];
  for (const raw of head.split("\n")) {
    const s = raw.trim();
    if (!s || !s.includes("usage") && !s.includes("token_count")) continue;
    let json: unknown;
    try {
      json = JSON.parse(s);
    } catch {
      continue;
    }
    const parsed = parseUsageLine(json);
    if (!parsed) continue;
    if (parsed.line.ts < startMs) continue;
    if (parsed.snapshot) {
      /* codex 累计快照:按 ts 有序入列(乱序旧行垫底,末位截断时淘汰) */
      const last = snaps[snaps.length - 1];
      if (last && parsed.line.ts < last.ts) continue;
      snaps.push(parsed.line);
    } else {
      lines.push(parsed.line);
    }
  }
  if (snaps.length > snapKeep) snaps.splice(0, snaps.length - snapKeep);
  return [...lines, ...snaps];
}

/**
 * 头窗口文本 → 最近一次真实用户输入行时间戳(速度估算的轮种子)。
 * 行型(跨家族同型,准入先例:claude/qoder transcript + omp/pi family +
 * codex event_msg 三家族消费同一「用户发话=新轮」磁盘知识):
 * - claude/qoder/omp/pi:`message.role=="user"` 且 content 非工具结果
 *   (list 带 tool_result = 工具回传,不是新轮);
 * - codex:`type=="event_msg"` + `payload.type=="user_message"`。
 * 与 usage 行同文件同时钟域(SSH 远端会话无钟偏)。识别不到 = null。
 */
export function lastUserTurnSeed(head: string): number | null {
  let seed: number | null = null;
  for (const raw of head.split("\n")) {
    const s = raw.trim();
    if (!s || !s.includes('"user')) continue;
    let json: unknown;
    try {
      json = JSON.parse(s);
    } catch {
      continue;
    }
    if (typeof json !== "object" || json === null) continue;
    const o = json as Record<string, unknown>;
    let ts: number | null;
    if (o.type === "event_msg") {
      const p = o.payload as Record<string, unknown> | undefined;
      if (!p || p.type !== "user_message") continue;
      ts = parseTs(o.timestamp);
    } else {
      const msg = o.message as Record<string, unknown> | undefined;
      if (!msg || msg.role !== "user") continue;
      const c = msg.content;
      if (
        Array.isArray(c) &&
        c.some(
          (b) =>
            typeof b === "object" && b !== null && (b as Record<string, unknown>).type === "tool_result",
        )
      ) {
        continue; // 工具回传行:轮内,不作种子
      }
      ts = parseTs(o.timestamp) ?? parseTs(msg.completedAt);
    }
    if (ts !== null && (seed === null || ts >= seed)) seed = ts;
  }
  return seed;
}

/** 会话用量汇总(展示层入参;cacheRead+cacheWrite 归 cache)。 */
export interface UsageSummary {
  input: number;
  output: number;
  cache: number;
  cost?: number;
}

/** 行列表 → 汇总;空行 = null(调用方不展示)。 */
export function summarizeUsage(lines: readonly UsageLine[]): UsageSummary | null {
  if (lines.length === 0) return null;
  const s: UsageSummary = { input: 0, output: 0, cache: 0 };
  for (const l of lines) {
    s.input += l.input;
    s.output += l.output;
    s.cache += l.cacheRead + l.cacheWrite;
    if (l.cost) s.cost = (s.cost ?? 0) + l.cost;
  }
  return s;
}

/** 汇总 → 短文案(`≈ 12.3k tok · $0.041`);无 cost 时省略美元段。 */
export function formatUsage(s: UsageSummary): string {
  const tok = s.input + s.output + s.cache;
  const tokText =
    tok >= 1_000_000
      ? `${(tok / 1_000_000).toFixed(1)}M`
      : tok >= 1000
        ? `${(tok / 1000).toFixed(1)}k`
        : String(tok);
  return s.cost != null ? `≈ ${tokText} tok · $${s.cost.toFixed(3)}` : `≈ ${tokText} tok`;
}

/** 相邻样本对时距下限(毫秒):CLI 攒批刷盘会令相邻行时间戳聚簇,低于此值
 * 的差分除法会爆出天文数字,宁缺勿爆丢弃该对。 */
const MIN_SPEED_SPAN_MS = 500;

/** 单样本对时距上限(毫秒):超过视为长停顿(轮间空闲残余/超大工具链),
 * 墙钟均速在该段上无意义,剔除。实证(2026-10-03 本机 omp 会话):轮内对
 * p90=48s,180s 剔除误伤 1.2%,跨轮残余(gap 51s~21min)全灭。 */
const TURN_GAP_CAP_MS = 180_000;

/** 滑窗样本对数:最近 N 对 Σ分子 ÷ Σ时距 聚合。实证回放:N=5 时相邻显示值
 * 跳变比 p90 从 16.2x 收敛到 2.0x。 */
const SPEED_WINDOW_PAIRS = 5;

/** 单对速率可信上限(tok/s):真实 API 输出速度上限 ~250,超 300 的对几乎必是
 * 刷盘聚簇 artifact(实证 2026-10-03 本机 codex 快照对:>300 占 2.8%,p99=654,
 * 极值 1165 —— 短间隔快照对捆绑了整段爆发的 token)。宁缺勿爆,弃该对。 */
const SPEED_PAIR_RATE_CAP = 300;

/**
 * 近窗响应均速 tok/s(增量行分子 = 本条 output;codex 快照行分子 = 末两拍差)。
 * seedTs(lastUserTurnSeed 产出)之前的行整轮剔除;`(种子→种子后首条)` 计为
 * 首对样本(含提交→首条完成的排队与首字等待,第一条消息完成即可显示)。
 * 无有效对 → null(调用方不展示)。
 * 口径天花板:行时间戳是 CLI 写盘时刻(消息结束),窗口含排队/首字等待/
 * 工具执行,数值系统性偏低 —— 指示用途,勿与协议级精确计量对标。
 */
export function recentTokPerSec(
  lines: readonly UsageLine[],
  seedTs?: number,
): number | null {
  const inTurn = seedTs != null ? lines.filter((l) => l.ts > seedTs) : lines;
  if (inTurn.length === 0) return null;
  const pairs: Array<{ num: number; span: number }> = [];
  const first = inTurn[0]!;
  if (seedTs != null && !first.snapshot) {
    /* 种子对:提交 → 首条完成(增量型;快照型值含历史,与种子无从差分) */
    const span = first.ts - seedTs;
    if (span >= MIN_SPEED_SPAN_MS && span <= TURN_GAP_CAP_MS && first.output > 0) {
      pairs.push({ num: first.output, span });
    }
  }
  for (let i = 1; i < inTurn.length; i++) {
    const a = inTurn[i - 1]!;
    const b = inTurn[i]!;
    const span = b.ts - a.ts;
    if (span < MIN_SPEED_SPAN_MS || span > TURN_GAP_CAP_MS) continue;
    /* 分子分派:增量行 = b.output(值即本条新生成量);快照行 = 末两拍差
     * (值含历史;前拍非快照 = 混列防御,弃)。 */
    const num = b.snapshot ? (a.snapshot ? b.output - a.output : NaN) : b.output;
    if (!(num > 0)) continue;
    if (num / (span / 1000) > SPEED_PAIR_RATE_CAP) continue; // 聚簇 artifact,弃
    pairs.push({ num, span });
  }
  if (pairs.length === 0) return null;
  const win = pairs.slice(-SPEED_WINDOW_PAIRS);
  const numSum = win.reduce((s, p) => s + p.num, 0);
  const spanSum = win.reduce((s, p) => s + p.span, 0);
  return numSum / (spanSum / 1000);
}

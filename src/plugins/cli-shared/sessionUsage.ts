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

/** 单条 usage 行(归一后)。 */
export interface UsageLine {
  ts: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: number;
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
        cacheRead: num(t.cached_input_tokens),
        cacheWrite: num(t.cache_write_input_tokens),
      },
    };
  }

  return null;
}

/**
 * 头窗口文本 → 归一行列表。codex 快照:同会话只留 ts 最大的一条;
 * 逐行语义其余累加由调用方聚合;窗口外(startMs 前)行丢弃。
 */
export function extractUsageFromHead(head: string, startMs: number): UsageLine[] {
  const lines: UsageLine[] = [];
  let snap: UsageLine | null = null;
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
      /* codex 累计快照:留末次 */
      if (!snap || parsed.line.ts >= snap.ts) snap = parsed.line;
    } else {
      lines.push(parsed.line);
    }
  }
  if (snap) lines.push(snap);
  return lines;
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

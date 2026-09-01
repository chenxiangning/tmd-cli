/**
 * Codex 额度本地快照 ── 走 codex CLI 自己的数据路径,零 HTTP。
 *
 * 背景:codex TUI 的 5h/7d 额度来自每次 API 响应内嵌的 rate_limits 元数据,
 * 由 CLI 持久化到 rollout 文件(~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl)
 * 的 event_msg/token_count 事件里。读最新快照 = CLI 内置查询方式,
 * 避免直接调 /backend-api/wham/usage(实证有封号风险)。
 *
 * 事件结构(实证 codex-cli 0.152.0):
 * ```json
 * { "timestamp": "...", "type": "event_msg",
 *   "payload": { "type": "token_count", "info": {...},
 *     "rate_limits": { "limit_id": "codex", "plan_type": "prolite",
 *       "primary":   { "used_percent": 65.0, "window_minutes": 10080, "resets_at": 1788748094 },
 *       "secondary": null | {...} } } }
 * ```
 *
 * 代价:快照是"最近一次对话时"的数据,非实时;planLabel 附快照时间,不假装实时。
 */

import { ipc } from "@kernel/ipc";
import type { QuotaWindow } from "@kernel/quota";

const ROLLOUT_TAIL_BYTES = 256 * 1024;
/** 最多回扫的 rollout 文件数(按 mtime 倒序;最新文件可能尚无额度事件)。 */
const MAX_ROLLOUT_FILES = 8;

export interface CodexLocalQuota {
  windows: QuotaWindow[];
  planLabel?: string;
  /** 快照产生时间(token_count 事件时间戳,ms epoch)。 */
  snapshotAt?: number;
}

interface RolloutWindow {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
}

function asNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function windowLabel(minutes: number | undefined, slot: "primary" | "secondary"): string {
  if (minutes !== undefined && minutes > 0) {
    if (minutes === 300) return "5小时";
    if (minutes === 10080) return "7天";
    if (minutes % 1440 === 0) return `${minutes / 1440}天`;
    if (minutes % 60 === 0) return `${minutes / 60}小时`;
    return `${minutes}分钟`;
  }
  return slot === "primary" ? "5小时" : "7天";
}

function windowOrder(label: string): number {
  if (label === "5小时") return 0;
  if (label === "7天") return 1;
  return 2;
}

function toWindow(raw: unknown, slot: "primary" | "secondary"): QuotaWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as RolloutWindow;
  const pct = asNum(w.used_percent);
  if (pct === undefined) return null;
  const minutes = asNum(w.window_minutes);
  const resetsAtSec = asNum(w.resets_at);
  const label = windowLabel(minutes, slot);
  const clamped = Math.round(Math.min(100, Math.max(0, pct)));
  return resetsAtSec !== undefined
    ? { label, displayPercent: clamped, resetsAt: resetsAtSec * 1000 }
    : { label, displayPercent: clamped };
}

/**
 * 纯解析:rollout 文件尾部文本 → 最新 token_count 的 rate_limits 快照。
 * 无快照(尚未对话/API key 模式无套餐窗口)返回 null。
 */
export function parseCodexRolloutTail(tail: string): CodexLocalQuota | null {
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || !line.includes("token_count")) continue;
    let event: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      event = parsed as Record<string, unknown>;
    } catch {
      continue; // 尾部首行可能是截断 JSON
    }
    const payload = event.payload;
    if (!payload || typeof payload !== "object") continue;
    const rl = (payload as Record<string, unknown>).rate_limits;
    if (!rl || typeof rl !== "object") continue;
    const rec = rl as Record<string, unknown>;

    const windows = (
      [toWindow(rec.primary, "primary"), toWindow(rec.secondary, "secondary")] as const
    )
      .filter((w): w is QuotaWindow => w !== null)
      // 同窗口去重(primary 先入先赢),按 5h→7d 排序
      .filter((w, idx, arr) => arr.findIndex((x) => x.label === w.label) === idx)
      .sort((a, b) => windowOrder(a.label) - windowOrder(b.label));
    if (windows.length === 0) continue;

    const quota: CodexLocalQuota = { windows };
    if (typeof rec.plan_type === "string" && rec.plan_type.trim()) {
      quota.planLabel = rec.plan_type.trim();
    }
    const ts = event.timestamp;
    if (typeof ts === "string") {
      const t = Date.parse(ts);
      if (Number.isFinite(t)) quota.snapshotAt = t;
    }
    return quota;
  }
  return null;
}

/** 扫描 ~/.codex/sessions 最新 rollout 文件,取第一份有效额度快照。 */
export async function readCodexLocalQuota(): Promise<CodexLocalQuota> {
  const home = await ipc.configHomeDir();
  const files = await ipc
    .fsCollectFiles(`${home}/.codex/sessions`, ".jsonl")
    .catch(() => []);
  for (const file of files.slice(0, MAX_ROLLOUT_FILES)) {
    const tail = await ipc.fsReadTail(file.path, ROLLOUT_TAIL_BYTES).catch(() => "");
    if (!tail) continue;
    const quota = parseCodexRolloutTail(tail);
    if (quota) return quota;
  }
  throw new Error("本机 codex 会话暂无额度快照(至少完成一轮对话后可见)");
}

/** 快照时间 → planLabel 后缀,例 "prolite · 快照 22:45"。 */
export function codexPlanLabelWithSnapshot(quota: CodexLocalQuota): string | undefined {
  const parts: string[] = [];
  if (quota.planLabel) parts.push(quota.planLabel);
  if (quota.snapshotAt) {
    const d = new Date(quota.snapshotAt);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    parts.push(`快照 ${hh}:${mm}`);
  }
  return parts.length ? parts.join(" · ") : undefined;
}

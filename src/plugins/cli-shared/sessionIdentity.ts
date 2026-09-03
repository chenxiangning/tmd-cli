/**
 * 会话文件身份自证(readSessionFileIdentity 的共享解析,纯函数可测)。
 * 两个格式家族,均实证自本机磁盘(2026-09-03):
 * - pi 家族(omp/pi):首行 {"type":"session","id","cwd","timestamp"(ISO)};
 * - claude 家族(claude/qoder):每行携带 "sessionId",cwd/timestamp 在消息行字段里。
 * codex(session_meta)、grok(summary.json)、kimi(state.json)格式独有,
 * 由各自插件就地解析。内核只做扫描与匹配,不理解任何 CLI 的格式(kernel/cli.ts)。
 */

import type { SessionFileIdentity } from "@kernel/cli";

/** 行 → 对象;尾部截断/坏 JSON = null。 */
function tryParse(line: string): Record<string, unknown> | null {
  try {
    const event: unknown = JSON.parse(line);
    return event && typeof event === "object"
      ? (event as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** 原始 JSON 字符串值 → 解码文本;坏转义 = undefined。 */
function decodeJsonString(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(`"${raw}"`);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** ISO 时间戳 → ms epoch;缺失/坏值 = undefined。 */
function isoToMs(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * pi 家族头部 → 身份。只认 "type":"session" 行(首行,防对话内容同名字段误匹配);
 * 无该行(截断/老格式)= null,内核退回水位线仲裁。
 */
export function parsePiFamilySessionHead(head: string): SessionFileIdentity | null {
  for (const line of head.split("\n")) {
    if (!line.includes('"type":"session"')) continue;
    const frame = tryParse(line);
    if (!frame || typeof frame.id !== "string" || !frame.id) continue;
    if (frame.type !== "session") continue;
    return {
      id: frame.id,
      cwd: typeof frame.cwd === "string" && frame.cwd ? frame.cwd : undefined,
      createdAt: isoToMs(frame.timestamp),
    };
  }
  return null;
}

/**
 * claude 家族头部 → 身份。逐行扫描 head 窗口,取首个非空观测:
 * id = "sessionId" 字段(文件名同名,但以内容为准);cwd/timestamp 取消息行字段。
 * createdAt 语义随分发版而异:claude 的 file-history-snapshot 时间戳 ≈ 会话创建
 * (spawn);qoder 首个时间戳在首条用户消息行 ≈ 首条消息时刻 —— 若 qoder 实测为
 * 首条消息才落盘(懒落盘),距离评分对它退化为弱证据,以 spawn 时即存在的
 * id-only 单候选路径为准。窗口内找不到 sessionId = null(不猜)。
 */
export function parseClaudeFamilySessionHead(head: string): SessionFileIdentity | null {
  let id: string | undefined;
  let cwd: string | undefined;
  let createdAt: number | undefined;
  for (const line of head.split("\n")) {
    if (!line.includes('"sessionId"') && !line.includes('"cwd"') && !line.includes('"timestamp"')) {
      continue;
    }
    if (!id) {
      const value = line.match(/"sessionId"\s*:\s*"([^"]+)"/)?.[1];
      if (value) id = value;
    }
    if (!cwd && line.includes('"cwd"')) {
      const raw = line.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
      const decoded = raw ? decodeJsonString(raw) : undefined;
      if (decoded) cwd = decoded;
    }
    if (createdAt === undefined) {
      const raw = line.match(/"timestamp"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
      const ms = raw ? isoToMs(decodeJsonString(raw) ?? undefined) : undefined;
      if (ms !== undefined) createdAt = ms;
    }
    if (id && cwd && createdAt !== undefined) break;
  }
  return id ? { id, cwd, createdAt } : null;
}

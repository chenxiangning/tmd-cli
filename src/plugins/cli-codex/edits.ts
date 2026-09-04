/**
 * codex 会话写入事件适配器(readSessionEdits)—— 审批线 events 归因第二信号源。
 *
 * 数据源 = codex 自己的 rollout JSONL(~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl,
 * 不按 cwd 分目录;条目形态实证自 2026-04 真实会话文件):
 * - 写入走 `custom_tool_call`(name = "apply_patch"),input = unified patch 文本,
 *   文件路径在补丁头:`*** Update File: <path>` / `*** Add File:` / `*** Delete File:`;
 *   `*** Move to: <path>` 是重命名目标,与源路径都算触碰。
 * - codex 纪律(其自身 AGENTS 约束)是改文件必须走 apply_patch,shell 写文件不入境 ——
 *   与「宁漏勿误」同向;exec 类 shell 写入本就不该混进 AI 批次。
 *
 * 会话定位:rollout 文件名含会话 uuid,但目录是全量时间桶 —— 定位结果按会话 id
 * 缓存(会话文件只追加不改名,缓存永久有效),避免每次轮询全树扫描。
 */

import type { CliSessionEdit } from "@kernel/cli";
import { normalizeEditPath } from "@kernel/editWatch";
import { ipc } from "@kernel/ipc";

import { parseEditEventsFromText, readEditsTail } from "../cli-shared/sessionEdits";

/** 补丁头:`*** Update File: path` / `*** Add File:` / `*** Delete File:`(行首锚定)。 */
const PATCH_FILE = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/;

/** 重命名目标:`*** Move to: path`(与源路径都算本轮触碰)。 */
const PATCH_MOVE = /^\*\*\* Move to: (.+)$/;

/** 已定位的会话 rollout 文件(会话 id → 绝对路径);未命中的会话下次轮询再找。 */
const locatedPaths = new Map<string, string>();

/** 一行已解析 JSON → 写入事件(非 apply_patch 调用返回空)。 */
function editEventsOf(entry: Record<string, unknown>, cwd: string): CliSessionEdit[] {
  if (!("payload" in entry) || typeof entry.payload !== "object" || entry.payload === null) {
    return [];
  }
  const p = entry.payload as Record<string, unknown>; // 已 narrowing 为 object,字段在下方逐一守卫
  if (p.type !== "custom_tool_call" || p.name !== "apply_patch") return [];
  if (typeof p.input !== "string") return [];
  const ts = Date.parse(typeof entry.timestamp === "string" ? entry.timestamp : "");
  if (!Number.isFinite(ts)) return [];

  const paths = new Set<string>();
  for (const line of p.input.split("\n")) {
    const m = PATCH_FILE.exec(line) ?? PATCH_MOVE.exec(line);
    if (!m) continue;
    const path = normalizeEditPath(m[1].trim(), cwd);
    if (path) paths.add(path);
  }
  return [...paths].map((path) => ({ path, ts }));
}

/**
 * 从 codex rollout JSONL 文本提取写入事件(纯函数,可测)。
 * sinceTs = 水位线:只返回 ts > sinceTs 的事件;循环契约见 cli-shared/sessionEdits.ts。
 */
export function parseCodexEditEvents(text: string, sinceTs: number, cwd: string): CliSessionEdit[] {
  return parseEditEventsFromText(
    text,
    sinceTs,
    cwd,
    (line) => line.startsWith('{"type":"response_item"'),
    editEventsOf,
  );
}

/** 定位会话 rollout 文件:全量收集文件名按 id 匹配,命中后缓存。 */
async function locateRollout(cliSessionId: string): Promise<string | null> {
  const cached = locatedPaths.get(cliSessionId);
  if (cached) return cached;
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  const files = await ipc.fsCollectFiles(`${home}/.codex/sessions`, ".jsonl").catch(() => []);
  const hit = files.find((entry) => entry.name.includes(cliSessionId))?.path ?? null;
  if (hit) locatedPaths.set(cliSessionId, hit);
  return hit;
}

/**
 * readSessionEdits 实现:定位 rollout → 尾窗读 → 解析增量事件。
 * 文件尚不存在返回 [];尾窗读取失败返回 null(调用方保水位线重试)。
 */
export async function readCodexSessionEdits(
  cwd: string,
  cliSessionId: string,
  sinceTs: number,
): Promise<CliSessionEdit[] | null> {
  return readEditsTail(await locateRollout(cliSessionId), sinceTs, cwd, parseCodexEditEvents);
}

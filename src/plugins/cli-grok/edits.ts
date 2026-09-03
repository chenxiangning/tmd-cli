/**
 * grok 会话写入事件适配器(readSessionEdits)—— 审批线 events 归因第二信号源。
 *
 * 数据源 = grok 会话目录内的 updates.jsonl(ACP session/update 事件流;
 * 实证自 2026-08 真实会话目录 ~/.grok/sessions/<encodeURIComponent(cwd)>/<uuid>/):
 * - 写入事件 = `sessionUpdate:"tool_call"` 且 `_meta.x.ai/tool.kind === "edit"`
 *   (实证 search_replace / write 都是 kind=edit);路径在 `rawInput.file_path`(绝对);
 * - 时间戳是**秒级** epoch(`timestamp` 字段),×1000 归一为 ms —— 同秒内对同一
 *   文件的多次写入只取一次,秒级精度决定了计数是近似值(可接受,轨迹可审计)。
 *
 * chat_history.jsonl 的 tool_calls 无时间戳,做不了水位线增量与迟到判定,
 * 不用作信号源;events.jsonl 是 MCP 诊断流,同样不适用。
 */

import type { CliSessionEdit } from "@kernel/cli";
import { normalizeEditPath } from "@kernel/editWatch";
import { ipc } from "@kernel/ipc";

/** 尾窗预算:updates 流含大量 thought/message 分片,两次轮询间覆盖到 2MB。 */
const TAIL_BYTES = 2 * 1024 * 1024;

/** edit 类工具(供应商 kind 字段缺省时的名字兜底;实证 search_replace/write)。 */
const EDIT_TOOL_NAMES: Record<string, true> = {
  search_replace: true,
  write: true,
  edit: true,
  write_file: true,
  multiedit: true,
};

/** 一行已解析 JSON → 写入事件(非 edit 类 tool_call 返回空)。 */
function editEventsOf(entry: Record<string, unknown>, cwd: string): CliSessionEdit[] {
  if (!("params" in entry) || typeof entry.params !== "object" || entry.params === null) {
    return [];
  }
  const params = entry.params as Record<string, unknown>;
  if (!("update" in params) || typeof params.update !== "object" || params.update === null) {
    return [];
  }
  const u = params.update as Record<string, unknown>;
  if (u.sessionUpdate !== "tool_call") return [];
  const tsSec = typeof entry.timestamp === "number" ? entry.timestamp : Number.NaN;
  if (!Number.isFinite(tsSec)) return [];
  const ts = tsSec * 1000;

  // 写入判定:供应商自分类 kind=edit 优先;缺失时按实证工具名白名单兜底
  const meta =
    typeof u._meta === "object" && u._meta !== null && "x.ai/tool" in u._meta
      ? ((u._meta as Record<string, unknown>)["x.ai/tool"] as unknown)
      : undefined;
  const tool =
    typeof meta === "object" && meta !== null
      ? (meta as Record<string, unknown>)
      : undefined;
  const kind = typeof tool?.kind === "string" ? tool.kind : undefined;
  const name = typeof tool?.name === "string" ? tool.name : undefined;
  if (kind !== "edit" && !(name && EDIT_TOOL_NAMES[name])) return [];

  const rawInput = typeof u.rawInput === "object" && u.rawInput !== null ? u.rawInput : undefined;
  const filePath =
    rawInput && "file_path" in rawInput && typeof rawInput.file_path === "string"
      ? rawInput.file_path
      : undefined;
  if (!filePath) return [];
  const path = normalizeEditPath(filePath, cwd);
  return path ? [{ path, ts }] : [];
}

/**
 * 从 grok updates.jsonl 文本提取写入事件(纯函数,可测)。
 * sinceTs = 水位线:只返回 ts > sinceTs 的事件(增量;坏行/窗口截断跳过)。
 */
export function parseGrokEditEvents(text: string, sinceTs: number, cwd: string): CliSessionEdit[] {
  const out: CliSessionEdit[] = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"sessionUpdate":"tool_call"')) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // 尾窗截断的坏行
    }
    for (const event of editEventsOf(entry, cwd)) {
      if (event.ts > sinceTs) out.push(event);
    }
  }
  return out;
}

/**
 * readSessionEdits 实现:定位会话目录 → updates.jsonl 尾窗读 → 解析增量事件。
 * 文件尚不存在返回 [];尾窗读取失败返回 null(调用方保水位线重试)。
 */
export async function readGrokSessionEdits(
  cwd: string,
  cliSessionId: string,
  sinceTs: number,
): Promise<CliSessionEdit[] | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  // 会话目录名 = encodeURIComponent(cwd)(实证:分隔符 → %2F,中文亦编码)
  const dir = `${home}/.grok/sessions/${encodeURIComponent(cwd)}/${cliSessionId}`;
  const path = `${dir}/updates.jsonl`;
  const tail = await ipc.fsReadTail(path, TAIL_BYTES).catch(() => null);
  if (tail === null) {
    // 未装 grok / 会话未产生 updates 流都落到这里;与「文件未建 = 零事件」同义,
    // 但 fsReadTail 失败无法区分不存在与读失败 —— 统一按零事件,不卡水位线。
    return [];
  }
  return parseGrokEditEvents(tail, sinceTs, cwd);
}

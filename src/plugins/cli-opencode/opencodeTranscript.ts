/**
 * opencode 会话转录 —— opencode.db(SQLite)part/message 行 → 转录块。
 * 查询经内核只读原语 sqliteQuery(单库多会话,表结构知识集中本插件;db.ts 同源)。
 *
 * 行型实证(2026-09-28 本机 ~/.local/share/opencode/opencode.db):
 * - message.data:{"role":"user"|"assistant"};part.data:
 *   {"type":"text","text"}(正文)/ {"type":"tool","tool",state{status,
 *   input{filePath,…},output?,time{start,end}}}(工具部件,启动建行完成原地更新)。
 * - part 行挂 message_id,session_id 冗余列可直接过滤;time_created 为 ms epoch。
 * - reasoning 部件形态未实证 → 宽容跳过(宁漏勿误)。
 */

import { ipc } from "@kernel/ipc";
import type { CliTranscriptBlock, CliToolPreview } from "@kernel/cli";
import { toolPreviewKindOf } from "../cli-shared/sessionTranscript";
import { isWrapperText } from "../cli-shared/userMessages";


/** 工具部件 state.output → 文本(实证形态 string;异构 JSON 收窄,宽容)。 */
function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output == null) return "";
  try {
    return JSON.stringify(output);
  } catch {
    return "";
  }
}

/** 查询行(unknown[][])→ 转录块(纯函数,可测)。 */
export function opencodeTranscriptRows(
  rows: unknown[][],
): CliTranscriptBlock[] {
  const out: CliTranscriptBlock[] = [];
  for (const row of rows) {
    const rowid = Number(row[0]);
    const role = typeof row[1] === "string" ? row[1] : "";
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(String(row[2])) as unknown;
      if (!parsed || typeof parsed !== "object") continue;
      data = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = data.type;
    const id = `p${rowid}`;
    if (type === "text" && typeof data.text === "string" && data.text.trim()) {
      if (role === "user") {
        if (!isWrapperText(data.text)) {
          out.push({ id, role: "user", text: data.text });
        }
      } else if (role === "assistant") {
        out.push({ id, role: "assistant", text: data.text });
      }
      continue;
    }
    if (type === "tool") {
      const name = typeof data.tool === "string" && data.tool ? data.tool : "tool";
      const state =
        data.state && typeof data.state === "object"
          ? (data.state as Record<string, unknown>)
          : {};
      const status = typeof state.status === "string" ? state.status : undefined;
      const input =
        state.input && typeof state.input === "object"
          ? (state.input as Record<string, unknown>)
          : {};
      const kind = toolPreviewKindOf(name);
      const preview: CliToolPreview | undefined =
        kind === "write" || kind === "read"
          ? {
              kind,
              path: typeof input.filePath === "string" ? input.filePath : undefined,
            }
          : kind
            ? { kind }
            : undefined;
      out.push({
        id,
        role: "tool",
        text: outputText(state.output),
        tool: {
          title: name,
          status: status ?? "called",
          ...(preview ? { preview } : {}),
        },
      });
    }
  }
  return out;
}

/** 读会话完整转录;库/会话读不到返回 null(查看器错误占位)。 */
export async function readOpencodeTranscript(
  dbPath: string,
  cliSessionId: string,
): Promise<CliTranscriptBlock[] | null> {
  const rows = await ipc
    .sqliteQuery(
      dbPath,
      "SELECT p.rowid, json_extract(m.data, '$.role'), p.data \
       FROM part p JOIN message m ON p.message_id = m.id \
       WHERE p.session_id = ?1 \
       ORDER BY p.time_created, p.rowid",
      [cliSessionId],
    )
    .catch(() => null);
  return rows ? opencodeTranscriptRows(rows) : null;
}

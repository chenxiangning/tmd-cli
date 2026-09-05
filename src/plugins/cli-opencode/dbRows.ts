/**
 * opencode.db 行解析纯函数 —— 自 db.ts 拆出(文件规模铁则)。
 *
 * sqlite 行值收窄(num/str/jsonString)+ 各查询的行 → 归一结构映射;
 * 全部纯函数可测(契约单测见 db.test.ts,经 db.ts re-export 维持导入路径)。
 */

import type {
  CliDiskSession,
  CliSessionEdit,
  CliSessionStatus,
  CliUserMessage,
  SessionFileIdentity,
} from "@kernel/cli";

/** sqlite 行值 → number(INTEGER 列);异型返回 undefined。 */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** sqlite 行值 → 非空 string;异型返回 undefined。 */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** 外部 JSON 逐层收窄取 string;缺失/异型返回 undefined。 */
function jsonString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : undefined;
}

/** 合成会话路径:<dbPath>#<sessionId>(readSessionFileIdentity 拆包消费)。 */
export function opencodeSessionPath(dbPath: string, sessionId: string): string {
  return `${dbPath}#${sessionId}`;
}

/** listSessions 行 [id,title,time_created,time_updated] → CliDiskSession。 */
export function opencodeDiskSessionRows(
  dbPath: string,
  rows: unknown[][],
): CliDiskSession[] {
  const out: CliDiskSession[] = [];
  for (const row of rows) {
    const id = str(row[0]);
    if (!id) continue;
    out.push({
      id,
      title: str(row[1]),
      /* modifiedAt 契约 = 最近修改:time_updated 优先(复活检测/相对时间/排序都吃它;
         本机实证 56/56 会话 updated>created,CLI 内 /resume 只增长 updated)。 */
      modifiedAt: num(row[3]) ?? num(row[2]) ?? 0,
      path: opencodeSessionPath(dbPath, id),
    });
  }
  return out;
}

/** 身份自证行 [directory,time_created] → SessionFileIdentity。 */
export function opencodeIdentityRow(sessionId: string, row: unknown[] | null): SessionFileIdentity | null {
  if (!row) return null;
  return {
    id: sessionId,
    cwd: str(row[0]),
    createdAt: num(row[1]),
  };
}

/**
 * 最新 message.data JSON → {provider, model};缺失/异型返回 null。
 * 双形态实证(2026-09-05):assistant 消息的 providerID/modelID 在顶层,
 * user 消息嵌套在 model 字段下(且首条可能整缺)。
 */
export function parseOpencodeMessageModel(data: unknown): { provider: string; model: string } | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  const provider = jsonString(obj.model, "providerID") ?? jsonString(obj, "providerID");
  const model = jsonString(obj.model, "modelID") ?? jsonString(obj, "modelID");
  return provider && model ? { provider, model } : null;
}

/** session.model JSON → variant;缺失/"default" 返回 undefined(思考强度只在显式档位展示)。 */
export function parseOpencodeModelVariant(data: unknown): string | undefined {
  const variant = jsonString(data, "variant");
  return variant && variant !== "default" ? variant : undefined;
}

/** 状态合成:message 模型 + session variant → CliSessionStatus;两者皆缺 = null。 */
export function opencodeSessionStatus(
  messageModel: { provider: string; model: string } | null,
  variant: string | undefined,
): CliSessionStatus | null {
  const model = messageModel
    ? `${messageModel.provider}/${messageModel.model}`
    : undefined;
  return model || variant ? { model, thinkingLevel: variant } : null;
}

/** 用户消息行 [messageId,text] → CliUserMessage[](同 id 多部件保留首条)。 */
export function opencodeUserMessageRows(rows: unknown[][]): CliUserMessage[] {
  const out: CliUserMessage[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = str(row[0]);
    const text = str(row[1]);
    if (!id || text === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, text });
  }
  return out;
}

/** 工具部件 data JSON + 行 time_created → 写入事件;非已完成的 write/edit 返回 null。 */
export function parseOpencodeToolEdit(data: unknown, rowTs: number | undefined): CliSessionEdit | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (obj.type !== "tool") return null;
  if (obj.tool !== "write" && obj.tool !== "edit") return null;
  const state = obj.state;
  if (!state || typeof state !== "object") return null;
  const stateObj = state as Record<string, unknown>;
  if (stateObj.status !== "completed") return null;
  const input = stateObj.input;
  const filePath = jsonString(input, "filePath");
  if (!filePath) return null;
  const time = stateObj.time;
  const end =
    time && typeof time === "object"
      ? (time as Record<string, unknown>).end
      : undefined;
  return { path: filePath, ts: num(end) ?? rowTs ?? 0 };
}

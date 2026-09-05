/**
 * opencode.db 只读知识 —— opencode CLI 私有 SQLite 存储的表结构/行格式集中地。
 *
 * 实证自 ~/.local/share/opencode/opencode.db(opencode 1.18.25,2026-09-05):
 * - 活跃存储为单库多会话(WAL),旧 storage/ JSON 布局已停写,不支持;
 * - session 表:id(ses_*)、title、directory(spawn cwd)、time_created/time_updated(ms)、
 *   model(JSON: {id, providerID, variant});
 * - message 表:data JSON({role, time.created, model{providerID, modelID}});
 * - part 表:用户消息正文 {"type":"text","text"};工具部件
 *   {"type":"tool","tool","state":{status, input{filePath}, time{start,end}}}。
 *
 * 经内核通用只读原语 ipc.sqliteQuery 代读(omp agent.db 同款先例),内核不理解本格式。
 * 单库多会话 → CliDiskSession.path 用合成路径 `<dbPath>#<sessionId>`
 * (契约「目录类插件自行拼内部路径」同精神),身份自证按 # 拆包后查库;
 * mtime 水位兜底在共享单库下必串线,故必须声明内容级身份绑定。
 */

import { ipc } from "@kernel/ipc";
import type {
  CliDiskSession,
  CliSessionEdit,
  CliSessionStatus,
  CliUserMessage,
  SessionFileIdentity,
} from "@kernel/cli";
/* 经 cli-shared 消费 opencode 磁盘布局(合法通道,准入先例见其文件头)。 */
import { opencodeDataDir } from "../cli-shared/opencodeDisk";

/** 用户消息尾部窗口大小(full=false 时的增量读上限,对齐其余引擎惯例)。 */
const USER_MSG_TAIL = 40;

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


/** opencode.db 路径;数据目录解析失败 = null(调用方按能力缺失降级)。 */
export async function opencodeDbPath(): Promise<string | null> {
  const dir = await opencodeDataDir();
  return dir ? `${dir}/opencode.db` : null;
}

/** 合成会话路径:<dbPath>#<sessionId>(readSessionFileIdentity 拆包消费)。 */
export function opencodeSessionPath(dbPath: string, sessionId: string): string {
  return `${dbPath}#${sessionId}`;
}

/* ── 纯函数行解析(可测) ───────────────────────────────── */

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
      modifiedAt: num(row[2]) ?? num(row[3]) ?? 0,
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

/* ── 查询(sqliteQuery 封装;失败按契约降级) ─────────────── */

/** 历史会话列表(directory = spawn cwd 精确匹配,实测本机数据)。 */
export async function listOpencodeSessions(cwd: string): Promise<CliDiskSession[]> {
  const db = await opencodeDbPath();
  if (!db) return [];
  const rows = await ipc
    .sqliteQuery(
      db,
      "SELECT id, title, time_created, time_updated FROM session \
       WHERE directory = ?1 ORDER BY time_updated DESC",
      [cwd],
    )
    .catch(() => [] as unknown[][]);
  return opencodeDiskSessionRows(db, rows);
}


/** 内容级身份自证:合成路径拆 # 后按 id 查库。 */
export async function readOpencodeSessionIdentity(
  path: string,
): Promise<SessionFileIdentity | null> {
  const hash = path.lastIndexOf("#");
  if (hash < 0) return null;
  const db = path.slice(0, hash);
  const sessionId = path.slice(hash + 1);
  const rows = await ipc
    .sqliteQuery(db, "SELECT directory, time_created FROM session WHERE id = ?1", [
      sessionId,
    ])
    .catch(() => [] as unknown[][]);
  return opencodeIdentityRow(sessionId, rows[0] ?? null);
}

/** 会话当前状态:最新 message 的模型 + session.model 的 variant。 */
export async function readOpencodeSessionStatus(
  _cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const db = await opencodeDbPath();
  if (!db) return null;
  const [msgRows, sesRows] = await Promise.all([
    ipc
      .sqliteQuery(
        db,
        "SELECT data FROM message WHERE session_id = ?1 \
         ORDER BY time_created DESC LIMIT 1",
        [cliSessionId],
      )
      .catch(() => [] as unknown[][]),
    ipc
      .sqliteQuery(db, "SELECT model FROM session WHERE id = ?1", [cliSessionId])
      .catch(() => [] as unknown[][]),
  ]);
  let messageModel: { provider: string; model: string } | null = null;
  let variant: string | undefined;
  try {
    messageModel = parseOpencodeMessageModel(JSON.parse(String(msgRows[0]?.[0] ?? "null")));
    variant = parseOpencodeModelVariant(JSON.parse(String(sesRows[0]?.[0] ?? "null")));
  } catch {
    /* JSON 损坏按未识别降级 */
  }
  return opencodeSessionStatus(messageModel, variant);
}

/** 用户消息(锚点栏数据源):message(role=user) ⋈ part(type=text)。 */
export async function readOpencodeUserMessages(
  _cwd: string,
  cliSessionId: string,
  full: boolean,
): Promise<CliUserMessage[] | null> {
  const db = await opencodeDbPath();
  if (!db) return null;
  const base =
    "SELECT m.id, json_extract(p.data, '$.text') FROM part p \
     JOIN message m ON p.message_id = m.id \
     WHERE m.session_id = ?1 \
       AND json_extract(m.data, '$.role') = 'user' \
       AND json_extract(p.data, '$.type') = 'text'";
  const sql = full
    ? `${base} ORDER BY p.time_created`
    : `${base} ORDER BY p.time_created DESC LIMIT ${USER_MSG_TAIL}`;
  const rows = await ipc.sqliteQuery(db, sql, [cliSessionId]).catch(() => null);
  if (!rows) return null;
  const messages = opencodeUserMessageRows(rows);
  return full ? messages : messages.reverse();
}

/** AI 写入事件(checkpoints events 归因):已完成的 write/edit 工具部件,增量水位。 */
export async function readOpencodeSessionEdits(
  _cwd: string,
  cliSessionId: string,
  sinceTs: number,
): Promise<CliSessionEdit[] | null> {
  const db = await opencodeDbPath();
  if (!db) return null;
  const rows = await ipc
    .sqliteQuery(
      db,
      "SELECT data, time_created FROM part \
       WHERE session_id = ?1 AND time_created > ?2 \
         AND json_extract(data, '$.type') = 'tool' \
         AND json_extract(data, '$.tool') IN ('write', 'edit') \
       ORDER BY time_created",
      /* INTEGER 亲和性把文本参数转数值比较(sqlite 语义)。 */
      [cliSessionId, String(sinceTs)],
    )
    .catch(() => null);
  if (!rows) return null;
  const out: CliSessionEdit[] = [];
  for (const row of rows) {
    try {
      const edit = parseOpencodeToolEdit(JSON.parse(String(row[0])), num(row[1]));
      if (edit) out.push(edit);
    } catch {
      /* 单行 JSON 损坏跳过,不影响同批其余事件 */
    }
  }
  return out;
}

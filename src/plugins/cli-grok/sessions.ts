/**
 * grok 磁盘会话存储 —— 自 index.tsx 拆出(叶子模块,移动端 home 历史直用)。
 * 布局实证(自 ~/.grok/sessions/ 真实目录,grok 1.0.4):
 * - 目录 = ~/.grok/sessions/<encodeURIComponent(cwd)>/<session-uuid>/
 *   会话是目录而非单文件;目录名即 sessionId(encodeURIComponent:/→%2F、
 *   中文→%E5%86%85…,实证 /Users/x/code/内容分析 → %2FUsers%2Fx%2Fcode%2F%E5%86%85…分析)。
 *   已知边界:Windows cwd 反斜杠路径的编码形态未实证(本机仅 macOS),扫不到 = 空列表降级。
 * - 会话目录内 summary.json 是元数据真相:generated_title/session_summary(标题)、
 *   current_model_id(模型)、updated_at/last_active_at(时间)。
 * - 对话记录 = chat_history.jsonl;真实用户输入包裹 <user_query> 标签。
 */

import { ipc } from "@kernel/ipc";
import type { CliDiskSession, CliSessionStatus, SessionFileIdentity } from "@kernel/cli";

export function grokSessionsDirName(cwd: string): string {
  return encodeURIComponent(cwd);
}

export async function grokSessionsDir(cwd: string): Promise<string | null> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return null;
  return `${home}/.grok/sessions/${grokSessionsDirName(cwd)}`;
}

/** summary.json 的解析结果(纯数据,可测)。 */
interface GrokSummary {
  title?: string;
  model?: string;
  /** updated_at(优先)或 last_active_at 的 ms epoch;解析失败 = undefined。 */
  updatedAt?: number;
  /** created_at 的 ms epoch(会话创建时刻,resume 不改写)。 */
  createdAt?: number;
}

/** 外部 JSON 逐层收窄取 string;缺失/异型/空串返回 undefined。 */
function summaryString(obj: unknown, key: string): string | undefined {
  if (!obj || typeof obj !== "object" || !(key in obj)) return undefined;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * summary.json 文本 → 会话元数据(纯函数,可测)。
 * 实证字段:info.{id,cwd}、generated_title ≈ session_summary、
 * current_model_id、created_at/updated_at/last_active_at(ISO 8601)。
 */
export function parseGrokSummary(raw: string): GrokSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title =
    summaryString(parsed, "generated_title") ?? summaryString(parsed, "session_summary");
  const model = summaryString(parsed, "current_model_id");
  const iso =
    summaryString(parsed, "updated_at") ?? summaryString(parsed, "last_active_at");
  const ms = iso ? Date.parse(iso) : NaN;
  const createdIso = summaryString(parsed, "created_at");
  const createdMs = createdIso ? Date.parse(createdIso) : NaN;
  return {
    title,
    model,
    updatedAt: Number.isFinite(ms) ? ms : undefined,
    createdAt: Number.isFinite(createdMs) ? createdMs : undefined,
  };
}

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 身份自证:path = 会话目录,summary.json 的 info.{id,cwd} + created_at
 * (会话创建时刻,ISO 8601;内容级绑定按它对齐 spawn 时刻)。
 */
export async function readGrokSessionIdentity(path: string): Promise<SessionFileIdentity | null> {
  const raw = await ipc.fsReadFile(`${path}/summary.json`).catch(() => null);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const info: unknown = (parsed as Record<string, unknown>).info;
  if (!info || typeof info !== "object") return null;
  const id = summaryString(info, "id");
  if (!id) return null;
  const iso = summaryString(parsed, "created_at");
  const ms = iso ? Date.parse(iso) : NaN;
  return {
    id,
    cwd: summaryString(info, "cwd"),
    createdAt: Number.isFinite(ms) ? ms : undefined,
  };
}

export async function listGrokSessions(cwd: string): Promise<CliDiskSession[]> {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return [];
  const entries = await ipc.fsListDir(dir).catch(() => []);
  /* summary.json 读取互不依赖,并发;结果保持 entries 原序,单文件失败容错不变。 */
  return Promise.all(
    entries.flatMap((entry) => {
      // 会话目录 = UUID 命名;summary.json.lock 等杂项天然被正则排除。
      if (!entry.isDir || !SESSION_ID_RE.test(entry.name)) return [];
      return [
        (async (): Promise<CliDiskSession> => {
          const raw = await ipc
            .fsReadFile(`${dir}/${entry.name}/summary.json`)
            .catch(() => null);
          const summary = raw ? parseGrokSummary(raw) : null;
          return {
            id: entry.name,
            title: summary?.title,
            modifiedAt: summary?.updatedAt ?? 0,
            /* 创建时刻定死日历落位:resume 只刷 updated_at,created_at 不动。 */
            createdAt: summary?.createdAt,
            path: `${dir}/${entry.name}`,
          };
        })(),
      ];
    }),
  );
}

export async function readGrokSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return null;
  const raw = await ipc
    .fsReadFile(`${dir}/${cliSessionId}/summary.json`)
    .catch(() => null);
  const model = raw ? parseGrokSummary(raw)?.model : undefined;
  // grok 推理强度不落盘到 summary(会话内 /model 或 --reasoning-effort 私有态),不提供 thinkingLevel。
  return model ? { model } : null;
}

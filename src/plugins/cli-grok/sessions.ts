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
import { readStatesBatched, pruneStateCache } from "../cli-shared/stateFileCache";
import { readStatusTailGated } from "../cli-shared/sessionStatus";

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
  /* collect 直接收 summary.json(FileStamp 带 mtime):UUID 目录外杂项
     天然不进,非 UUID 目录的 summary 同被 SESSION_ID_RE 滤掉。mtime 闸
     (cli-shared/stateFileCache):summary 落盘后静态,resume/改名刷 mtime
     才重读 —— 稳态重扫收敛为单次 collect(2026-10-06 消留观 1:原实现
     fsListDir + 逐会话全量重读 summary,外网周期流量 N+1)。 */
  const stamps = await ipc.fsCollectFiles(dir, "summary.json").catch(() => []);
  const files = stamps.flatMap((s) => {
    const m = /^(?:.*\/)?([^/]+)\/summary\.json$/.exec(s.path);
    return m && SESSION_ID_RE.test(m[1])
      ? [{ id: m[1], path: `${dir}/${m[1]}`, summaryPath: s.path, modifiedAt: s.modifiedAt }]
      : [];
  });
  pruneStateCache(new Set(files.map((f) => f.summaryPath)));
  const summaries = await readStatesBatched(
    files.map((f) => ({ path: f.summaryPath, modifiedAt: f.modifiedAt })),
    parseGrokSummary,
  );
  /* collect 按 mtime 倒序;消费方(桌面/手机列表)均按时间排序,顺序变化无害。 */
  return files.map((f, i) => {
    const summary = summaries[i];
    return {
      id: f.id,
      title: summary?.title,
      modifiedAt: summary?.updatedAt ?? f.modifiedAt,
      /* 创建时刻定死日历落位:resume 只刷 updated_at,created_at 不动。 */
      createdAt: summary?.createdAt,
      path: f.path,
    };
  });
}

export async function readGrokSessionStatus(
  cwd: string,
  cliSessionId: string,
): Promise<CliSessionStatus | null> {
  const dir = await grokSessionsDir(cwd);
  if (!dir) return null;
  /* 状态巡航(2s)尺寸闸:summary.json 稳态不变,未变即短路不重读 ——
   * 列表侧 E1 已走 stateFileCache,这里补状态侧同律(外网中继 2s 全量传输消)。
   * 直拼路径型免 revalidateMs(grok 会话目录不移动)。 */
  return readStatusTailGated(
    `grok:${dir}/${cliSessionId}`,
    async () => `${dir}/${cliSessionId}/summary.json`,
    64 * 1024,
    (text) => {
      const model = parseGrokSummary(text)?.model;
      return model ? { model } : null;
    },
  );
}

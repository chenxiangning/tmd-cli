/**
 * Server 编辑弹窗的草稿模型与行编辑纯函数 —— 从 ServerEditModal.tsx
 * 拆出(2026-10-20 守 300 行铁则;零语义改动,函数体原样搬迁)。
 * 语义见 ServerEditModal 文件头:transport 三选互斥 / 未知键整条保留 /
 * 非字符串值并回 / JSON 家写显式 type、TOML 家不写。
 */
import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";
import { inferTransport, type McpTransport } from "./entryModel";

export interface KvRow {
  id: number;
  k: string;
  v: string;
}
let rowSeq = 0;
export const newRow = (k = "", v = ""): KvRow => ({ id: ++rowSeq, k, v });

export interface Draft {
  id: string;
  transport: McpTransport;
  command: string;
  cwd: string;
  argsText: string;
  envRows: KvRow[];
  url: string;
  headerRows: KvRow[];
}

export const TRANSPORTS = (["stdio", "http", "sse"] as const).map((id) => ({ id, label: id }));

export function toRows(record: unknown): KvRow[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record).filter(([, v]) => typeof v === "string").map(([k, v]) => newRow(k, v as string));
}

export function toDraft(name: string | null, entry: McpServerEntry): Draft {
  const transport = inferTransport(entry);
  return {
    id: name ?? "",
    transport,
    command: typeof entry.command === "string" ? entry.command : "",
    cwd: typeof entry.cwd === "string" ? entry.cwd : "",
    argsText: Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === "string").join("\n") : "",
    envRows: toRows(entry.env),
    url: typeof entry.url === "string" ? entry.url : "",
    headerRows: toRows(entry.headers),
  };
}

/** 草稿守卫比较基线:KvRow.id 仅作 React key 不入比较,字段与键值序全量对比。 */
export const normDraft = (d: Draft): string => JSON.stringify({ ...d, envRows: d.envRows.map((r) => [r.k, r.v]), headerRows: d.headerRows.map((r) => [r.k, r.v]) });

/** draft → 原生条目:未知键整条保留;非字符串 env/headers 值并回(不静默丢)。 */
export function toEntry(draft: Draft, format: "json" | "toml", original: McpServerEntry): McpServerEntry {
  const entry: McpServerEntry = { ...original };
  for (const k of ["command", "args", "env", "cwd", "url", "headers", "type"]) delete entry[k];
  if (format === "json") entry.type = draft.transport;
  if (draft.transport === "stdio") {
    entry.command = draft.command.trim();
    if (draft.cwd.trim()) entry.cwd = draft.cwd.trim();
    const args = draft.argsText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (args.length) entry.args = args;
    entry.env = kvRecord(draft.envRows, original.env);
  } else {
    entry.url = draft.url.trim();
    entry.headers = kvRecord(draft.headerRows, original.headers);
  }
  return entry;
}

/** 行编辑器 → 记录;原记录中非字符串值(不可行编辑)按原样并回。 */
export function kvRecord(rows: KvRow[], original: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(original && typeof original === "object" && !Array.isArray(original) ? (original as Record<string, unknown>) : {})) {
    if (typeof v !== "string") out[k] = v;
  }
  for (const row of rows) {
    const k = row.k.trim();
    if (k) out[k] = row.v;
  }
  return out;
}

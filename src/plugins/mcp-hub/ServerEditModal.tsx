/**
 * server 编辑弹窗 —— ServerDraft 字段集(transport 三选互斥;stdio 组
 * command/cwd/args/env;remote 组 url/headers)。保存 = 读原文 → .bak-tmd
 * 备份 → mcpWrite upsert → 写回(hubStore);id 改名 = 删旧 + 增新。
 * env/headers 值列默认掩码(SecretInput 眼睛切换明文,密钥脱敏纪律);
 * 未知键(startup_timeout_sec 等)整条保留;JSON 家写显式 type 字段
 * (claude 磁盘实证),TOML 家不写(codex 磁盘实证)。
 */
import { useEffect, useState } from "react";
import { t } from "@kernel/i18n";
import { DialogShell, DialogActions, useEscClose } from "@kernel/DialogShell";
import { SecretInput } from "@kernel/SecretInput";
import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";
import type { McpEngineState } from "./hubStore";
import { renameServer, upsertServer } from "./hubStore";
import { inferTransport, type McpTransport } from "./entryModel";

interface KvRow {
  id: number;
  k: string;
  v: string;
}
let rowSeq = 0;
const newRow = (k = "", v = ""): KvRow => ({ id: ++rowSeq, k, v });

interface Draft {
  id: string;
  transport: McpTransport;
  command: string;
  cwd: string;
  argsText: string;
  envRows: KvRow[];
  url: string;
  headerRows: KvRow[];
}

const TRANSPORTS = (["stdio", "http", "sse"] as const).map((id) => ({ id, label: id }));

function toRows(record: unknown): KvRow[] {
  if (!record || typeof record !== "object" || Array.isArray(record)) return [];
  return Object.entries(record).filter(([, v]) => typeof v === "string").map(([k, v]) => newRow(k, v as string));
}

function toDraft(name: string | null, entry: McpServerEntry): Draft {
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
const normDraft = (d: Draft): string => JSON.stringify({ ...d, envRows: d.envRows.map((r) => [r.k, r.v]), headerRows: d.headerRows.map((r) => [r.k, r.v]) });

/** draft → 原生条目:未知键整条保留;非字符串 env/headers 值并回(不静默丢)。 */
function toEntry(draft: Draft, format: "json" | "toml", original: McpServerEntry): McpServerEntry {
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
function kvRecord(rows: KvRow[], original: unknown): Record<string, unknown> {
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

function KvEditor({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: KvRow[];
  onChange: (rows: KvRow[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1.5">
          <input
            className="mcphub-input w-36 flex-none"
            value={row.k}
            aria-label={`${label} KEY`}
            onChange={(e) => onChange(rows.map((r) => (r.id === row.id ? { ...r, k: e.target.value } : r)))}
          />
          <div className="min-w-0 flex-1">
            <SecretInput
              id={`mcphub-kv-${row.id}`}
              value={row.v}
              onChange={(v) => onChange(rows.map((r) => (r.id === row.id ? { ...r, v } : r)))}
            />
          </div>
          <button
            type="button"
            className="mcphub-icon-btn hover:text-(--tmd-diff-removed)"
            title={t("移除此行")}
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="mcphub-ghost-btn self-start" onClick={() => onChange([...rows, newRow()])}>
        {t("加一行 {label}", { label })}
      </button>
    </div>
  );
}

export function ServerEditModal({
  engine,
  initialName,
  initialEntry,
  onClose,
}: {
  engine: McpEngineState;
  initialName: string | null;
  initialEntry: McpServerEntry;
  onClose: () => void;
}) {
  const [initialDraft] = useState(() => toDraft(initialName, initialEntry));
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  /* Esc 直关(提交中锁定);backdrop 才走 DialogShell onClose 的 dirty 守卫,两路分流。 */
  useEscClose(onClose, busy);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(onClose, 1500);
    return () => window.clearTimeout(timer);
  }, [saved, onClose]);

  const names = engine.entries ? Object.keys(engine.entries) : [];
  const idTaken = draft.id.trim() !== (initialName ?? "") && names.includes(draft.id.trim());
  const missingRequired =
    !draft.id.trim() ||
    idTaken ||
    (draft.transport === "stdio" ? !draft.command.trim() : !draft.url.trim());
  const dirty = normDraft(draft) !== normDraft(initialDraft);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = draft.id.trim();
      const entry = toEntry(draft, engine.format, initialEntry);
      if (initialName !== null && initialName !== name) {
        await renameServer(engine, initialName, name, entry);
      } else {
        await upsertServer(engine, name, entry);
      }
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogShell
      title={initialName === null ? t("新增 server · {engine}", { engine: engine.name }) : t("编辑 {name} · {engine}", { name: initialName, engine: engine.name })}
      icon={<span className="text-xs">MCP</span>}
      width={560}
      locked={busy}
      onClose={saved || !dirty ? onClose : () => undefined}
      footer={
        saved ? (
          <div className="flex items-center justify-end gap-3 text-xs text-(--tmd-fg-faint)">
            {t("已保存,下次会话生效(不承诺即时生效)")}
          </div>
        ) : (
          <div className="flex flex-col items-end gap-1">
            {error && <div className="max-w-full break-all text-meta text-(--tmd-diff-removed)">{error}</div>}
            <DialogActions
              className="mt-4"
              confirmLabel={t("保存")}
              confirmDisabled={missingRequired || busy}
              submitting={busy}
              onConfirm={() => void save()} onCancel={onClose}
            />
          </div>
        )
      }
    >
      <form className="flex flex-col gap-3 text-xs" onSubmit={(e) => { e.preventDefault(); if (!missingRequired && !busy && !saved) void save(); }}>
        <label className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-faint)">{t("名称(同文件内唯一)")}</span>
          <input
            className="mcphub-input"
            value={draft.id}
            aria-label={t("名称(同文件内唯一)")}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
          />
          {idTaken && <span className="text-meta text-(--tmd-diff-removed)">{t("同名 server 已存在")}</span>}
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-(--tmd-fg-faint)">{t("transport(三选互斥)")}</span>
          <div className="flex gap-1">
            {TRANSPORTS.map((tr) => (
              <button
                key={tr.id}
                type="button"
                aria-pressed={draft.transport === tr.id}
                className={`mcphub-seg-btn ${draft.transport === tr.id ? "is-on" : ""}`}
                onClick={() => setDraft({ ...draft, transport: tr.id })}
              >
                {tr.label}
              </button>
            ))}
          </div>
        </div>

        {draft.transport === "stdio" ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-(--tmd-fg-faint)">{t("command(必填)")}</span>
              <input
                className="mcphub-input"
                value={draft.command}
                aria-label={t("command(必填)")}
                onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-(--tmd-fg-faint)">{t("cwd(可选)")}</span>
              <input
                className="mcphub-input"
                value={draft.cwd}
                aria-label={t("cwd(可选)")}
                onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-(--tmd-fg-faint)">{t("args(每行一条)")}</span>
              <textarea
                className="mcphub-input h-20 font-mono text-meta"
                value={draft.argsText}
                aria-label={t("args(每行一条)")}
                onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-(--tmd-fg-faint)">{t("env(值默认掩码,眼睛显明文)")}</span>
              <KvEditor label="env" rows={draft.envRows} onChange={(envRows) => setDraft({ ...draft, envRows })} />
            </div>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-(--tmd-fg-faint)">{t("url(必填)")}</span>
              <input
                className="mcphub-input"
                value={draft.url}
                aria-label={t("url(必填)")}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-(--tmd-fg-faint)">{t("headers(值默认掩码,眼睛显明文)")}</span>
              <KvEditor label="headers" rows={draft.headerRows} onChange={(headerRows) => setDraft({ ...draft, headerRows })} />
            </div>
          </>
        )}

        {/* 回车隐式提交锚点:可见主钮在 footer(DialogActions,type=button),Enter 经此触发 onSubmit。 */}
        <button type="submit" hidden />
      </form>
    </DialogShell>
  );
}

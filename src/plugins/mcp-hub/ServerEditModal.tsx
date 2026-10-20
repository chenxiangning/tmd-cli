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
import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";
import type { McpEngineState } from "./hubStore";
import { renameServer, upsertServer } from "./hubStore";
import { KvEditor } from "./KvEditor";
import { TRANSPORTS, normDraft, toDraft, toEntry, type Draft } from "./serverEditDraft";

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

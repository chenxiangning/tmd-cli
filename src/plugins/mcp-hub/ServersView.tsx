/**
 * server 卡片列表视图 —— 选中引擎的 server 增删改查入口 + 行内连通测试徽标。
 * 读失败 = 错误态 + 原始文件预览(拒编辑防覆写);文件缺失(JSON 家)=
 * 「尚未创建,首存即建」空态。删除走 DialogShell 视口居中确认浮层
 * (err 红实心确认钮);测试结果为组件局部态,不产生任何持久状态。
 */
import { useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { Plus, Play, PencilSimple, TrashSimple, FileText, Plugs } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Empty } from "@kernel/Empty";
import { DialogActions, DialogShell } from "@kernel/DialogShell";
import type { McpServerEntry } from "@plugins/cli-shared/mcpWrite";
import type { McpEngineState } from "./hubStore";
import { removeServer } from "./hubStore";
import { inferTransport, summarizeEntry } from "./entryModel";
import { probeServer, type ProbeResult } from "./probe";
import { ServerEditModal } from "./ServerEditModal";
import { RawFilePreview } from "./RawFilePreview";

const TRANSPORT_LABEL: Record<string, string> = { stdio: "stdio", http: "http", sse: "sse" };

/** 测试徽标:pending = 呼吸点;ok = 工具数 + 延迟;败 = 错误首行(title 全文)。 */
function ProbeBadge({ result }: { result: ProbeResult | "pending" }) {
  if (result === "pending") {
    return <span className="mcphub-probe mcphub-prose-pending">{t("测试中…")}</span>;
  }
  if (result.ok) {
    return (
      <span className="mcphub-probe mcphub-prose-ok">
        {t("通了 · {n} 个工具 · {ms}ms", {
          n: result.toolsCount ?? "—",
          ms: result.latencyMs,
        })}
      </span>
    );
  }
  const firstLine = (result.error ?? "失败").split("\n")[0];
  return (
    <span className="mcphub-probe mcphub-prose-err" title={result.error}>
      {firstLine}
    </span>
  );
}

export function ServersView({ engine }: { engine: McpEngineState }) {
  const [editing, setEditing] = useState<{ name: string | null; entry: McpServerEntry } | null>(null);
  const [probes, setProbes] = useState<Record<string, ProbeResult | "pending">>({});
  const [showRaw, setShowRaw] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const names = engine.entries ? Object.keys(engine.entries) : [];

  const runProbe = (name: string) => {
    const entry = engine.entries?.[name];
    if (!entry) return;
    setProbes((p) => ({ ...p, [name]: "pending" }));
    void probeServer(entry).then((r) => setProbes((p) => ({ ...p, [name]: r })));
  };

  /* 确认浮层内执行删除;失败保留弹窗显错(错误原文不截断)。 */
  const doRemove = async (): Promise<void> => {
    if (pendingRemove === null) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeServer(engine, pendingRemove);
    } catch (e) {
      setRemoveError(errTextDisplay(e));
      return;
    } finally {
      setRemoving(false);
    }
    setPendingRemove(null);
  };

  if (engine.entries === null) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <p className="text-xs leading-relaxed text-(--tmd-diff-removed)">
          {t("配置文件读取/解析失败,已停止编辑以防覆写")}
        </p>
        <p className="max-w-lg break-all text-meta leading-relaxed text-(--tmd-fg-faint)">{engine.error}</p>
        <button type="button" className="mcphub-ghost-btn" onClick={() => setShowRaw(true)}>
          <FileText size="0.75rem" aria-hidden />
          {t("查看原始文件")}
        </button>
        {showRaw && <RawFilePreview engine={engine} onClose={() => setShowRaw(false)} />}
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="min-w-0 text-meta leading-relaxed text-(--tmd-fg-faint)">
          <span className="break-all">{engine.displayPath}</span>
          {!engine.exists && <span className="ml-1">{t("· 尚未创建,首次保存即建")}</span>}
        </div>
        <div className="flex flex-none items-center gap-1.5">
          <button type="button" className="mcphub-ghost-btn" onClick={() => setShowRaw(!showRaw)}>
            <FileText size="0.75rem" aria-hidden />
            {showRaw ? t("收起原文") : t("原始文件")}
          </button>
          <button
            type="button"
            className="mcphub-accent-btn"
            onClick={() => setEditing({ name: null, entry: {} })}
          >
            <Plus size="0.75rem" aria-hidden />
            {t("新增 server")}
          </button>
        </div>
      </div>

      {showRaw && <RawFilePreview engine={engine} onClose={() => setShowRaw(false)} />}

      {names.length === 0 ? (
        /* 空态统一形制:双分支文案为主句,动作直开新增弹窗(文件未创建分支同路,首存即建) */
        <Empty
          icon={<Plugs aria-hidden />}
          action={{ label: t("新增 server"), onClick: () => setEditing({ name: null, entry: {} }) }}
        >
          {engine.exists ? t("暂无 server;新增一台或从商店/导入页安装") : t("配置文件尚未创建;新增第一台即创建")}
        </Empty>
      ) : (
        <div className="flex flex-col gap-1.5">
          {names.map((name) => {
            const entry = engine.entries![name];
            const transport = inferTransport(entry);
            return (
              <div key={name} className="mcphub-card">
                <div className="flex items-center gap-2">
                  <span className={`mcphub-badge ${transport === "stdio" ? "" : "mcphub-badge-remote"}`}>{TRANSPORT_LABEL[transport]}</span>
                  <span className="min-w-0 truncate font-medium text-(--tmd-fg)" title={name}>{name}</span>
                  <div className="ml-auto flex flex-none items-center gap-1">
                    <button
                      type="button"
                      className="mcphub-icon-btn"
                      title={t("连通测试(一次性握手,不改配置)")}
                      onClick={() => runProbe(name)}
                    >
                      <Play size="0.75rem" aria-hidden />
                    </button>
                    <button type="button" className="mcphub-icon-btn" title={t("编辑")} onClick={() => setEditing({ name, entry })}>
                      <PencilSimple size="0.75rem" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="mcphub-icon-btn hover:text-(--tmd-diff-removed)"
                      title={t("删除")}
                      disabled={removing}
                      onClick={() => setPendingRemove(name)}
                    >
                      <TrashSimple size="0.75rem" aria-hidden data-icon-keep />
                    </button>
                  </div>
                </div>
                <div className="mt-1 truncate text-meta text-(--tmd-fg-faint)" title={summarizeEntry(entry)}>
                  {summarizeEntry(entry)}
                </div>
                {probes[name] !== undefined && (
                  <div className="mt-1">
                    <ProbeBadge result={probes[name]} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <ServerEditModal
          engine={engine}
          initialName={editing.name}
          initialEntry={editing.entry}
          onClose={() => setEditing(null)}
        />
      )}

      {pendingRemove !== null && (
        <DialogShell
          title={t("删除确认")}
          icon={<TrashSimple size="0.875rem" aria-hidden />}
          width={360}
          locked={removing}
          onClose={() => setPendingRemove(null)}
          footer={
            <DialogActions
              className="mt-4"
              danger
              confirmLabel={t("删除")}
              submitting={removing}
              onConfirm={() => void doRemove()}
              onCancel={() => setPendingRemove(null)}
            />
          }
        >
          <div data-mcphub-remove-confirm={pendingRemove}>
            <div className="mt-2 text-xs font-medium">
              {t("删除 {engine} 的 server「{name}」?(各家方言:删除即卸载)", {
                engine: engine.name,
                name: pendingRemove,
              })}
            </div>
            <div className="mt-1 text-xs text-(--tmd-fg-subtle)">
              {t("从配置文件移除该条目;已开的会话不受影响")}
            </div>
            {removeError && (
              <div className="mt-2 break-all text-xs text-(--tmd-err)" role="alert">{removeError}</div>
            )}
          </div>
        </DialogShell>
      )}
    </div>
  );
}

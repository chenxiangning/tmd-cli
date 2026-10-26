/**
 * 清理面(白名单,默认不动任何字节):
 * a) checkpoints 按工作区 —— 「清理到最近 10 个/30 天」走现成 checkpoint_prune
 *    (账本 rewrite + 清悬空 states/孤儿对象;按账本 ts 不按 mtime),两步武装
 *    确认(3s 回弹,workspace DangerAction 先例同款)。
 * b) docgen 已归档文档 —— 见 DocgenCleanup(确认卡仿 BatchRowParts ConfirmCard)。
 * c) 会话输出日志 —— 见 SessionLogCleanup(策略清理/全清,活会话保护)。
 * CLI 会话目录在本面无任何入口(红线:只报告不代删)。
 */

import { useEffect, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { workspaceDisplayName } from "@kernel/workspace";
import { listCkptWorkspaces, type CkptWorkspaceRow } from "./ckptWorkspaces";
import { formatBytes } from "./format";
import { DocgenCleanup } from "./DocgenCleanup";
import { SessionLogCleanup } from "./SessionLogCleanup";

/** 保留策略:最近 10 个批次 / 30 天(取二者交集语义,见 prune.rs)。 */
const KEEP = 10;
const TTL_DAYS = 30;
const ARM_MS = 3000;

export function CleanupTab() {
  const [rows, setRows] = useState<CkptWorkspaceRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [armedCwd, setArmedCwd] = useState<string | null>(null);
  const [busyCwd, setBusyCwd] = useState<string | null>(null);
  const [pruned, setPruned] = useState<Record<string, number>>({});
  const [opError, setOpError] = useState<string | null>(null);

  async function refresh() {
    setArmedCwd(null);
    try {
      const rs = await listCkptWorkspaces();
      setRows(rs);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  /* 武装 3s 回弹:无操作自动解除(marketInstalledRow 先例同款)。 */
  useEffect(() => {
    if (!armedCwd) return;
    const timer = window.setTimeout(() => setArmedCwd(null), ARM_MS);
    return () => clearTimeout(timer);
  }, [armedCwd]);

  async function prune(row: CkptWorkspaceRow) {
    setArmedCwd(null);
    setBusyCwd(row.workspace.root);
    setOpError(null);
    try {
      const removed = await ipc.checkpointPrune(row.workspace.root, KEEP, TTL_DAYS);
      setPruned((prev) => ({ ...prev, [row.workspace.root]: removed }));
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyCwd(null);
      void refresh();
    }
  }

  return (
    <div className="text-xs">
      <section className="mb-5">
        <h3 className="mb-1 font-semibold">{t("checkpoints 按工作区")}</h3>
        <p className="mb-2 text-(--tmd-fg-muted)">
          {t("对有快照的工作区执行「保留最近 {keep} 个批次且不超过 {days} 天」;账本 rewrite + 清孤儿对象,不可恢复。", { keep: KEEP, days: TTL_DAYS })}
        </p>
        {loadError && <p className="text-(--tmd-diff-deleted)">{t("加载失败:{error}", { error: loadError })}</p>}
        {opError && <p className="text-(--tmd-diff-deleted)">{t("操作失败:{error}", { error: opError })}</p>}
        {rows === null && !loadError && <p className="text-(--tmd-fg-muted)">{t("读取中…")}</p>}
        {rows !== null && rows.length === 0 && (
          <p className="text-(--tmd-fg-muted)">{t("当前没有工作区存在快照数据。")}</p>
        )}
        {rows?.map((row) => {
          const busy = busyCwd === row.workspace.root;
          const armed = armedCwd === row.workspace.root;
          return (
            <div
              key={row.workspace.id}
              className="flex items-center justify-between gap-2 border-b border-(--tmd-border) py-1.5 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="truncate font-medium">{workspaceDisplayName(row.workspace)}</span>
                <span className="ml-1.5 text-(--tmd-fg-muted) tabular-nums">
                  {formatBytes(row.bytes)} · {t("{n} 文件", { n: row.files })}
                </span>
                {row.workspace.root in pruned && (
                  <span className="ml-1.5 text-(--tmd-diff-inserted)">
                    {t("已清理 {n} 条", { n: pruned[row.workspace.root] })}
                  </span>
                )}
              </span>
              {armed ? (
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    className="h-6 rounded border border-(--tmd-diff-deleted)/50 px-2 text-(--tmd-diff-deleted) hover:bg-(--tmd-diff-deleted)/10 disabled:opacity-40"
                    onClick={() => void prune(row)}
                  >
                    {busy ? t("清理中…") : t("确认清理")}
                  </button>
                  <button
                    type="button"
                    className="h-6 rounded border border-(--tmd-border) px-2 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
                    onClick={() => setArmedCwd(null)}
                  >
                    {t("取消")}
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  title={t("清理到最近 {keep} 个/{days} 天", { keep: KEEP, days: TTL_DAYS })}
                  className="flex h-6 shrink-0 items-center gap-1 rounded border border-(--tmd-border) px-2 hover:bg-(--tmd-bg-hover) disabled:opacity-40"
                  onClick={() => setArmedCwd(row.workspace.root)}
                >
                  <Trash size="0.75rem" aria-hidden />
                  {t("清理")}
                </button>
              )}
            </div>
          );
        })}
      </section>

      <SessionLogCleanup />

      <DocgenCleanup />
    </div>
  );
}

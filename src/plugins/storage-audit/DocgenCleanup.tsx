/**
 * docgen 已归档文档清理(白名单动作 b)。行首「删除」展开明细确认卡
 * (仿 checkpoints BatchRowParts ConfirmCard),确认才动盘:
 * 索引条目移除 + docs/<entryId>/ 整删,不可恢复。
 */

import { useEffect, useState } from "react";
import { errTextDisplay } from "@kernel/errText";
import { Archive, Trash } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { readDocGenIndex } from "@plugins/workbench/docgen/paths";
import { removeArchivedEntry } from "@plugins/workbench/docgen/store";
import type { DocGenEntry } from "@plugins/workbench/docgen/types";
import { archivedEntries } from "./docgenArchive";

export function DocgenCleanup() {
  const [entries, setEntries] = useState<DocGenEntry[] | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setConfirmId(null);
    try {
      const index = await readDocGenIndex();
      setEntries(archivedEntries(index.entries));
    } catch (e) {
      setError(errTextDisplay(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function remove(entry: DocGenEntry) {
    setConfirmId(null);
    setBusyId(entry.id);
    setError(null);
    try {
      await removeArchivedEntry(entry.id);
    } catch (e) {
      setError(errTextDisplay(e));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }

  return (
    <section>
      <h3 className="mb-1 font-semibold">{t("已归档文档(docgen)")}</h3>
      <p className="mb-2 text-(--tmd-fg-muted)">
        {t("删除 docs/<entryId>/ 全部版本并移除索引条目,不可恢复;生成中的文档不在此列。")}
      </p>
      {error && <p className="mb-1 text-(--tmd-diff-deleted)">{t("操作失败:{error}", { error })}</p>}
      {entries === null && !error && <p className="text-(--tmd-fg-muted)">{t("读取中…")}</p>}
      {entries !== null && entries.length === 0 && (
        <p className="text-(--tmd-fg-muted)">{t("没有已归档文档。")}</p>
      )}
      {entries?.map((entry) => (
        <div key={entry.id}>
          <div className="flex items-center justify-between gap-2 border-b border-(--tmd-border) py-1.5 last:border-b-0">
            <span className="min-w-0">
              <Archive size="0.75rem" className="mr-1 inline align-baseline" aria-hidden />
              <span className="truncate font-medium">{entry.title}</span>
              <span className="ml-1.5 text-(--tmd-fg-muted)">
                {entry.periodLabel} · {t("{n} 个版本", { n: entry.versions.length })}
              </span>
            </span>
            <button
              type="button"
              disabled={busyId === entry.id}
              title={t("删除")}
              className="flex h-6 shrink-0 items-center gap-1 rounded border border-(--tmd-border) px-2 hover:bg-(--tmd-bg-hover) disabled:opacity-40"
              onClick={() => setConfirmId(confirmId === entry.id ? null : entry.id)}
            >
              <Trash size="0.75rem" aria-hidden />
              {busyId === entry.id ? t("删除中…") : t("删除")}
            </button>
          </div>
          {confirmId === entry.id && (
            <div className="mb-2 ml-4 rounded-(--tmd-radius-sm) border border-(--tmd-border-strong) bg-(--tmd-bg-popover) p-2.5">
              <div className="mb-1 font-semibold">{t("删除这份已归档文档?")}</div>
              <div className="mb-2 leading-relaxed text-(--tmd-fg-muted)">
                {t("将删除 docs/{id}/ 下全部版本文件与该索引条目,不可恢复。", { id: entry.id })}
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  className="h-6 rounded border border-(--tmd-border) px-2 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
                  onClick={() => setConfirmId(null)}
                >
                  {t("取消")}
                </button>
                <button
                  type="button"
                  disabled={busyId === entry.id}
                  className="h-6 rounded border border-(--tmd-diff-deleted)/50 px-2 text-(--tmd-diff-deleted) hover:bg-(--tmd-diff-deleted)/10 disabled:opacity-40"
                  onClick={() => void remove(entry)}
                >
                  {t("确认删除")}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

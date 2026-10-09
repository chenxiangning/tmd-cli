/**
 * worktree 列表拆件(WorktreeManageDialog 拆出,文件规模铁则)——
 * 加载期 spinner(null 态不再空白)/ 空态 / 条目行(两段式移除确认)。
 */
import { Trash } from "@phosphor-icons/react";
import { Spinner } from "@kernel/Spinner";
import { t } from "@kernel/i18n";
import type { WorktreeEntry } from "@kernel/ipc";

export function WorktreeList({
  cwd,
  list,
  busy,
  confirmPath,
  setConfirmPath,
  onRemove,
}: {
  cwd: string;
  /** null = 首拉在途(加载骨架);[] = 空;条目 = 就绪。 */
  list: WorktreeEntry[] | null;
  busy: string;
  confirmPath: string | null;
  setConfirmPath: (v: string | null) => void;
  onRemove: (entry: WorktreeEntry) => void;
}) {
  if (list === null) {
    /* 加载期骨架(首拉在途):null 态不再空白(audit 工单:列表加载期无反馈)。 */
    return (
      <div className="flex items-center justify-center gap-2 py-3 text-xs text-(--tmd-fg-faint)">
        <Spinner size="0.875rem" />
        {t("读取 worktree 列表…")}
      </div>
    );
  }
  return (
    <>
      {list.map((entry) => (
        <div
          key={entry.path}
          className="flex items-center gap-2 rounded-md border border-(--tmd-border)/60 px-2 py-1.5"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs text-(--tmd-fg)">
              <span className="truncate font-medium">{entry.path}</span>
              {entry.bare && <span className="text-meta text-(--tmd-fg-faint)">{t("(bare)")}</span>}
              {entry.locked && <span className="text-meta text-(--tmd-warn)">{t("已锁")}</span>}
              {entry.prunable && <span className="text-meta text-(--tmd-warn)">{t("可清理")}</span>}
            </div>
            <div className="truncate text-xs text-(--tmd-fg-faint)">
              {entry.detached ? t("(detached)") : entry.branch || entry.head}
            </div>
          </div>
          {!entry.bare && entry.path !== cwd && (
            confirmPath === entry.path ? (
              <button
                type="button"
                onClick={() => onRemove(entry)}
                disabled={busy === `rm:${entry.path}`}
                className="shrink-0 rounded-md bg-(--tmd-danger, #e5484d) px-2 py-1 text-xs text-white disabled:opacity-50"
              >
                {t("确认移除")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmPath(entry.path)}
                className="shrink-0 rounded-md border border-(--tmd-border) p-1 text-(--tmd-fg-faint) hover:text-(--tmd-fg)"
                aria-label={t("移除 worktree")}
              >
                <Trash size="0.75rem" data-decor-from="git-worktree" aria-hidden />
              </button>
            )
          )}
        </div>
      ))}
      {list.length === 0 && (
        <div className="py-2 text-center text-xs text-(--tmd-fg-faint)">{t("无 worktree")}</div>
      )}
    </>
  );
}

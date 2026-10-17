/**
 * worktree 列表拆件(WorktreeManageDialog 拆出,文件规模铁则)——
 * 加载期 spinner(null 态不再空白)/ 空态 / 条目行(两段式移除确认)。
 * 每行:磁盘占用(惰性拉取,弹层级缓存)+ 关联会话数(map 反查)。
 */
import { useEffect } from "react";
import { Trash } from "@phosphor-icons/react";
import { Spinner } from "@kernel/Spinner";
import { t } from "@kernel/i18n";
import { ipc, type WorktreeEntry } from "@kernel/ipc";

export function WorktreeList({
  cwd,
  list,
  busy,
  confirmPath,
  setConfirmPath,
  onRemove,
  usage,
  onUsage,
  sessionCount,
}: {
  cwd: string;
  /** null = 首拉在途(加载骨架);[] = 空;条目 = 就绪。 */
  list: WorktreeEntry[] | null;
  busy: string;
  confirmPath: string | null;
  setConfirmPath: (v: string | null) => void;
  onRemove: (entry: WorktreeEntry) => void;
  /** 磁盘占用缓存(path → 字节;"…" = 在途;失败项不缓存,切弹窗重试)。 */
  usage: Map<string, number>;
  /** 单行占用就绪回调(dialog 写缓存)。 */
  onUsage: (path: string, bytes: number) => void;
  /** wtPath → 关联会话数(tmd.wtSessions.v1 反查)。 */
  sessionCount: (path: string) => number;
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
          <DiskUsageCell cwd={cwd} path={entry.path} usage={usage} onUsage={onUsage} />
          <WtSessionCount count={sessionCount(entry.path)} />
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

/** 磁盘占用单元格:挂载即惰性拉取(dialog 缓存命中免重取);失败显 —。 */
function DiskUsageCell({
  cwd,
  path,
  usage,
  onUsage,
}: {
  cwd: string;
  path: string;
  usage: Map<string, number>;
  onUsage: (path: string, bytes: number) => void;
}) {
  const cached = usage.get(path);
  useEffect(() => {
    if (cached !== undefined) return;
    let alive = true;
    void ipc
      .gitWorktreeDiskUsage(cwd, path)
      .then((bytes) => alive && onUsage(path, bytes))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, path]);
  return (
    <span
      className="shrink-0 text-xs tabular-nums text-(--tmd-fg-faint)"
      title={t("磁盘占用(不含 .git)")}
    >
      {cached === undefined ? "…" : formatBytes(cached)}
    </span>
  );
}

/** 关联会话数徽标(0 不显)。 */
function WtSessionCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="thread-wt-badge shrink-0" title={t("{n} 个会话在此 worktree 中启动", { n: count })}>
      {count}
    </span>
  );
}

/** 字节 → 人类可读(B/KB/MB/GB,1024 进制,一位小数截尾)。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = -1;
  do {
    v /= 1024;
    u += 1;
  } while (v >= 1024 && u < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

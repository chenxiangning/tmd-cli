/**
 * 差异面板文件行 hover 动作簇 —— 自 DiffFlatRow.tsx 拆出(文件规模铁则):
 * 打开文件/位置小图标 +(取消)暂存 + 条件性「放弃工作区改动」/「删除未跟踪文件」。
 * 红色系动作(discard/clean)都是不可逆操作,确认弹层由调用方(DiffView)前置。
 */

import { t } from "@kernel/i18n";
import type { GitFileStatus } from "@kernel/ipc";
import { FileOpenActions } from "./FileRowActions";

export function RowHoverActions({
  file,
  stagedRow,
  canDiscard,
  canDelete,
  cwd,
  onStage,
  onUnstage,
  onDiscard,
  onDelete,
}: {
  file: GitFileStatus;
  stagedRow: boolean;
  canDiscard: boolean;
  canDelete: boolean;
  cwd: string;
  onStage: () => void;
  onUnstage: () => void;
  onDiscard: () => void;
  onDelete: () => void;
}) {
  return (
    <span className="hidden items-center gap-2 group-hover:flex">
      <FileOpenActions cwd={cwd} file={file} />
      {stagedRow ? (
        <button
          type="button"
          title={t("取消暂存(git reset)")}
          onClick={(e) => {
            e.stopPropagation();
            onUnstage();
          }}
          className="text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
        >
          {t("(取消暂存)")}
        </button>
      ) : (
        <button
          type="button"
          title={t("暂存(git add)")}
          onClick={(e) => {
            e.stopPropagation();
            onStage();
          }}
          className="text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline hover:underline-offset-2"
        >
          {t("(暂存)")}
        </button>
      )}
      {canDiscard && (
        <button
          type="button"
          title={t("放弃工作区改动(还原到暂存区;不可恢复)")}
          onClick={(e) => {
            e.stopPropagation();
            onDiscard();
          }}
          className="text-(--tmd-fg-faint) hover:text-(--tmd-diff-removed) hover:underline hover:underline-offset-2"
        >
          {t("(放弃)")}
        </button>
      )}
      {canDelete && (
        <button
          type="button"
          title={t("删除未跟踪文件(git clean;不可恢复)")}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-(--tmd-fg-faint) hover:text-(--tmd-diff-removed) hover:underline hover:underline-offset-2"
        >
          {t("(删除)")}
        </button>
      )}
    </span>
  );
}

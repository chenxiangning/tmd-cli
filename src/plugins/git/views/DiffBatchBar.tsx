/**
 * 差异面板批量条 —— 会话列表管理模式批量条(SessionManage wm-bar)同款交互:
 * 「已选 n」+ 按选中行组成分流动作(暂存 / 放弃 / 删除)。勾选集([x] 提交集)
 * 即多选面,拖选扩散与点勾都落同一集合;破坏性动作由 DiffView 确认弹层前置。
 * n = 各动作当前实际作用的文件数(选中集与三区行集求交后的动态子集)。
 */

import { t } from "@kernel/i18n";

interface Props {
  /** 勾选集中可参与批量动作的行数(决定批量条显隐) */
  count: number;
  stagePaths: string[];
  discardPaths: string[];
  deletePaths: string[];
  onStage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onDelete: (paths: string[]) => void;
}

const btnCls =
  "cursor-pointer text-[0.6875rem] hover:text-(--tmd-fg) hover:underline hover:underline-offset-2";
const dangerCls =
  "cursor-pointer text-[0.6875rem] text-(--tmd-diff-removed) hover:underline hover:underline-offset-2";

export function DiffBatchBar({
  count,
  stagePaths,
  discardPaths,
  deletePaths,
  onStage,
  onDiscard,
  onDelete,
}: Props) {
  if (count === 0) return null;
  return (
    <div className="sticky bottom-0 flex items-center gap-3 border-t border-(--tmd-border) bg-(--tmd-bg-base) px-3 py-1 text-[0.6875rem] text-(--tmd-fg-muted)">
      <span>{t("已选 {n}", { n: count })}</span>
      {stagePaths.length > 0 && (
        <button type="button" className={btnCls} onClick={() => onStage(stagePaths)}>
          {t("暂存 {n}", { n: stagePaths.length })}
        </button>
      )}
      {discardPaths.length > 0 && (
        <button
          type="button"
          title={t("放弃工作区改动(还原到暂存区;不可恢复)")}
          className={dangerCls}
          onClick={() => onDiscard(discardPaths)}
        >
          {t("放弃 {n}", { n: discardPaths.length })}
        </button>
      )}
      {deletePaths.length > 0 && (
        <button
          type="button"
          title={t("删除未跟踪文件(git clean;不可恢复)")}
          className={dangerCls}
          onClick={() => onDelete(deletePaths)}
        >
          {t("删除 {n}", { n: deletePaths.length })}
        </button>
      )}
    </div>
  );
}

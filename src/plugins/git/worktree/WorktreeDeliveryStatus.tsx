import type { GitBranchCompareSet } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import type { BranchCompareRequest } from "../views/BranchCompareModal";
import { canCreateWorktreePr, resolveWorktreeDelivery } from "./reviewPlan";

/** 干净 worktree 的本地交付结论;不猜测远端 PR 是否已合并。 */
export function WorktreeDeliveryStatus({
  compare,
  target,
  canCreate,
  disabledReason,
}: {
  compare: GitBranchCompareSet;
  target: string;
  canCreate: boolean;
  disabledReason: string | null;
}) {
  const ahead = compare.currentOnly.length;
  const behind = compare.targetOnly.length;
  const state = resolveWorktreeDelivery(ahead, canCreate);
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2 text-meta">
      <span className={state === "clean" ? "text-(--tmd-accent)" : "text-(--tmd-fg-muted)"}>
        {state === "clean"
          ? t("分支内容已包含在 {target} 中,可清理 worktree", { target })
          : t("有 {n} 个提交待交付", { n: ahead })}
      </span>
      {behind > 0 && <span className="text-(--tmd-warn)">{t("落后基线 {n} 个提交", { n: behind })}</span>}
      {state === "blocked" && (
        <span className="text-(--tmd-danger, #e5484d)">{disabledReason ?? t("当前无法创建 PR")}</span>
      )}
    </div>
  );
}

export function WorktreePrAction({ request, compare, onCreatePr }: {
  request: BranchCompareRequest;
  compare: GitBranchCompareSet | null;
  onCreatePr?: () => void;
}) {
  if (!onCreatePr || request.mode !== "compare" ||
    !canCreateWorktreePr(request.delivery, compare?.currentOnly.length ?? 0)) return null;
  return (
    <button type="button" onClick={onCreatePr}
      className="ml-auto rounded px-2 py-0.5 text-xs text-(--tmd-accent) hover:bg-(--tmd-bg-hover)">
      {t("创建 PR")}
    </button>
  );
}

export function WorktreeCompareDelivery({ request, compare }: {
  request: BranchCompareRequest;
  compare: GitBranchCompareSet | null;
}) {
  if (request.mode !== "compare" || !request.delivery || !compare) return null;
  return <WorktreeDeliveryStatus compare={compare} target={request.target} {...request.delivery} />;
}

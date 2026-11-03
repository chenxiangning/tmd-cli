import { useState } from "react";
import { GitDiff } from "@phosphor-icons/react";
import { errTextDisplay } from "@kernel/errText";
import { t } from "@kernel/i18n";
import { ipc, type WorktreeEntry } from "@kernel/ipc";
import { openDiffTab } from "../diffTab";
import { BranchCompareModal, type BranchCompareRequest } from "../views/BranchCompareModal";
import { CreatePrDialog } from "../views/remoteDialogs/CreatePrDialog";
import { resolveWorktreeReview, worktreeCompareName } from "./reviewPlan";
import "./locales";

/** 非主仓树的审阅 / 交付入口；所有 Git 读取与对话框均绑定该树路径。 */
export function WorktreeDelivery({
  entry,
  onError,
}: {
  entry: WorktreeEntry;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [compare, setCompare] = useState<BranchCompareRequest | null>(null);
  const [prOpen, setPrOpen] = useState(false);

  const review = async () => {
    setBusy(true);
    try {
      const status = await ipc.gitStatus(entry.path);
      const defaults = status.files.length === 0
        ? await ipc.gitPrDefaults(entry.path)
        : null;
      const next = resolveWorktreeReview(status, defaults?.baseBranch ?? "");
      if (next.mode === "diff") {
        for (const side of next.sides) {
          openDiffTab({ cwd: entry.path, staged: side === "staged" });
        }
      } else {
        setCompare({
          mode: "compare",
          target: next.target,
          delivery: { canCreate: defaults?.canCreate ?? false, disabledReason: defaults?.disabledReason ?? null },
        });
      }
    } catch (e) {
      onError(errTextDisplay(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={busy}
        title={t("审阅 / 交付")}
        aria-label={t("审阅 / 交付")}
        onClick={() => void review()}
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-meta text-(--tmd-fg-faint) hover:bg-(--tmd-bg-hover) hover:text-(--tmd-fg) disabled:opacity-50"
      >
        <GitDiff size="0.75rem" data-decor-from="git-worktree" aria-hidden />
        {t("审阅 / 交付")}
      </button>
      {compare && (
        <BranchCompareModal
          cwd={entry.path}
          currentName={worktreeCompareName(entry)}
          request={compare}
          onClose={() => setCompare(null)}
          onCreatePr={() => {
            setCompare(null);
            setPrOpen(true);
          }}
        />
      )}
      {prOpen && (
        <CreatePrDialog
          cwd={entry.path}
          headBranch={entry.branch}
          onClose={() => setPrOpen(false)}
        />
      )}
    </>
  );
}

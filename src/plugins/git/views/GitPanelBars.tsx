/**
 * GitPanel 横条件 —— 自 GitPanel.tsx 拆出(文件规模铁则)。
 * GitRemoteBar 聚合行(分支 → upstream · ⟳/fetch/pull/push)已按 UI 调整下掉
 * (2026-09-14):分支与 upstream 上移顶栏分支 label,远端操作走分支右键菜单
 * (更新/获取/推送)与快捷命令。本文件只剩 SmartSwitchUndoBanner =
 * 「暂存并切换」冲突还原横幅(确认框自带,GitConfirmDialog 是 fixed portal,挂此处不影响层级)。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ipc } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import { clearSmartSwitchOrigin } from "../panelStore";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";

export function SmartSwitchUndoBanner({
  cwd,
  undoOrigin,
  onNotice,
  afterMutation,
}: {
  cwd: string;
  undoOrigin: { cwd: string; branch: string };
  onNotice: (msg: string) => void;
  afterMutation: () => void;
}) {
  const [undoConfirm, setUndoConfirm] = useState<GitConfirmState | null>(null);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-(--tmd-border) bg-(--tmd-bg-sunken) px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-(--tmd-diff-removed)">
          {t("存在冲突(可能来自「暂存并切换」,原分支 {branch})", { branch: undoOrigin.branch })}
        </span>
        <button
          onClick={() => {
            const origin = undoOrigin;
            setUndoConfirm({
              title: t("还原到切换前的 {branch}?", { branch: origin.branch }),
              detail: t(
                "当前分支上的冲突标记与携带改动将被丢弃(内容已在 stash 中,不会丢失),切回原分支并自动恢复改动。",
              ),
              confirmLabel: t("还原"),
              onConfirm: () => {
                ipc.gitSmartCheckoutUndo(cwd, origin.branch).then(
                  () => {
                    clearSmartSwitchOrigin();
                    onNotice(t("已还原到 {branch},改动已恢复", { branch: origin.branch }));
                    afterMutation();
                  },
                  (e: unknown) => onNotice(gitErrorDisplay(e)),
                );
              },
            });
          }}
          className="shrink-0 rounded border border-(--tmd-accent) px-1.5 py-0.5 text-(--tmd-accent) hover:bg-(--tmd-accent-soft)"
        >
          {t("还原到切换前")}
        </button>
      </div>
      {undoConfirm && <GitConfirmDialog state={undoConfirm} onClose={() => setUndoConfirm(null)} />}
    </>
  );
}

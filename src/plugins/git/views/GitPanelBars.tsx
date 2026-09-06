/**
 * GitPanel 横条件 —— 自 GitPanel.tsx 拆出(文件规模铁则)。
 * GitRemoteBar = 聚合行(分支 → upstream · fetch/pull/push 语义图标,点击开对话框,
 * behind/ahead 计数上按钮);SmartSwitchUndoBanner = 「暂存并切换」冲突还原横幅
 * (确认框自带,GitConfirmDialog 是 fixed portal,挂此处不影响层级)。
 */

import { useState } from "react";
import { CloudDownload, Download, Loader2, Upload } from "lucide-react";
import { ipc, type GitAheadBehind, type GitRemoteRequest } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import { clearSmartSwitchOrigin } from "../panelStore";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";

type RemoteOp = GitRemoteRequest["op"];

export function GitRemoteBar({
  branch,
  upstream,
  remoteBusy,
  detached,
  aheadBehind,
  hasUpstream,
  onOpenDialog,
}: {
  branch: string | undefined;
  upstream: string | null | undefined;
  remoteBusy: RemoteOp | null;
  detached: boolean;
  aheadBehind: GitAheadBehind | null;
  hasUpstream: boolean;
  onOpenDialog: (op: RemoteOp) => void;
}) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-(--tmd-border) px-2 text-(--tmd-fg-muted)">
      <span className="shrink-0 font-medium text-(--tmd-fg)">{branch ?? "…"}</span>
      {upstream && (
        <span className="min-w-0 truncate text-(--tmd-fg-faint)">→ {upstream}</span>
      )}
      <span className="flex-1" />
      <div className="flex items-center gap-0.5">
      <button
        onClick={() => onOpenDialog("fetch")}
        disabled={remoteBusy !== null || detached}
        title="获取远端更新(fetch --all --prune,不动本地分支)"
        className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
      >
        {remoteBusy === "fetch" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CloudDownload className="h-3.5 w-3.5" />
        )}
      </button>
      <button
        onClick={() => onOpenDialog("pull")}
        disabled={remoteBusy !== null || detached}
        title={
          (aheadBehind?.behind ?? 0) > 0
            ? `拉取远端更新(落后 ${aheadBehind!.behind} 个提交)`
            : "拉取远端更新(对话框内可选远端与分支)"
        }
        className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
      >
        {remoteBusy === "pull" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {(aheadBehind?.behind ?? 0) > 0 && aheadBehind!.behind}
      </button>
      <button
        onClick={() => onOpenDialog("push")}
        disabled={remoteBusy !== null || detached}
        title={
          (aheadBehind?.ahead ?? 0) > 0
            ? `推送 ${aheadBehind!.ahead} 个提交(对话框内可预览)`
            : hasUpstream
              ? "推送(对话框内查看预览与选项)"
              : "推送新分支并建立 upstream"
        }
        className="flex items-center gap-0.5 rounded px-1 py-0.5 text-(--tmd-accent) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
      >
        {remoteBusy === "push" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        {(aheadBehind?.ahead ?? 0) > 0 && aheadBehind!.ahead}
      </button>
      </div>
    </div>
  );
}

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
          存在冲突(可能来自「暂存并切换」,原分支 {undoOrigin.branch})
        </span>
        <button
          onClick={() => {
            const origin = undoOrigin;
            setUndoConfirm({
              title: `还原到切换前的 ${origin.branch}?`,
              detail:
                "当前分支上的冲突标记与携带改动将被丢弃(内容已在 stash 中,不会丢失),切回原分支并自动恢复改动。",
              confirmLabel: "还原",
              onConfirm: () => {
                ipc.gitSmartCheckoutUndo(cwd, origin.branch).then(
                  () => {
                    clearSmartSwitchOrigin();
                    onNotice(`已还原到 ${origin.branch},改动已恢复`);
                    afterMutation();
                  },
                  (e: unknown) => onNotice(gitErrorDisplay(e)),
                );
              },
            });
          }}
          className="shrink-0 rounded border border-(--tmd-accent) px-1.5 py-0.5 text-(--tmd-accent) hover:bg-(--tmd-accent-soft)"
        >
          还原到切换前
        </button>
      </div>
      {undoConfirm && <GitConfirmDialog state={undoConfirm} onClose={() => setUndoConfirm(null)} />}
    </>
  );
}

/**
 * RemoteDialogGroup —— push/pull/fetch 三对话框的条件渲染段。
 * 自 GitPanel.tsx 拆出(文件规模铁则,GitPanelBars 同款先例);
 * 语义不变:dialog 命中即渲染对应对话框,执行链(runDialog)由 GitPanel 持有。
 */

import type { GitRemoteRequest } from "@kernel/ipc";
import { PushDialog } from "./remoteDialogs/PushDialog";
import { PullDialog } from "./remoteDialogs/PullDialog";
import { FetchDialog } from "./remoteDialogs/FetchDialog";

export function RemoteDialogGroup({
  cwd,
  dialog,
  branch,
  repoName,
  remoteBusy,
  onClose,
  onRun,
}: {
  cwd: string | null;
  dialog: GitRemoteRequest["op"] | null;
  branch: string;
  /** 当前仓目录名(多仓语境显示于对话框标题行右缘);单仓 undefined 不显示 */
  repoName?: string;
  remoteBusy: "push" | "pull" | "fetch" | null;
  onClose: () => void;
  onRun: (op: GitRemoteRequest["op"], req: GitRemoteRequest, label: string) => void;
}) {
  if (!cwd || !dialog) return null;
  if (dialog === "fetch") {
    return (
      <FetchDialog
        repoName={repoName}
        submitting={remoteBusy === "fetch"}
        onClose={onClose}
        onRun={(req, label) => onRun("fetch", req, label)}
      />
    );
  }
  const Dialog = dialog === "push" ? PushDialog : PullDialog;
  return (
    <Dialog
      cwd={cwd}
      branch={branch}
      repoName={repoName}
      submitting={remoteBusy === dialog}
      onClose={onClose}
      onRun={(req, label) => onRun(dialog, req, label)}
    />
  );
}

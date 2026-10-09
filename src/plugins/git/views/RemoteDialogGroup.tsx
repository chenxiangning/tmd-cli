/**
 * RemoteDialogGroup —— push/pull/fetch 三对话框的条件渲染段。
 * 自 GitPanel.tsx 拆出(文件规模铁则,GitPanelBars 同款先例);
 * 语义不变:dialog 命中即渲染对应对话框,执行链(runDialog)由 GitPanel 持有。
 */

import type { GitRemoteRequest } from "@kernel/ipc";
import type { RemoteDialogOp } from "../panelStore";
import { PushDialog } from "./remoteDialogs/PushDialog";
import { PullDialog } from "./remoteDialogs/PullDialog";
import { FetchDialog } from "./remoteDialogs/FetchDialog";
import { CreatePrDialog } from "./remoteDialogs/CreatePrDialog";

export function RemoteDialogGroup({
  cwd,
  dialog,
  branch,
  repoName,
  remoteBusy,
  pushOutcome,
  onClose,
  onRun,
}: {
  cwd: string | null;
  dialog: RemoteDialogOp | null;
  branch: string;
  /** 当前仓目录名(多仓语境显示于对话框标题行右缘);单仓 undefined 不显示 */
  repoName?: string;
  remoteBusy: "push" | "pull" | "fetch" | null;
  /** 推送回执(推送弹窗底栏 ✓/✗;非推送 op 恒 null)。 */
  pushOutcome: { ok: boolean; text: string } | null;
  onClose: () => void;
  onRun: (op: GitRemoteRequest["op"], req: GitRemoteRequest, label: string) => void;
}) {
  if (!cwd || !dialog) return null;
  if (dialog === "pr") {
    return <CreatePrDialog cwd={cwd} repoName={repoName} onClose={onClose} />;
  }
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
  if (dialog === "push") {
    return (
      <PushDialog
        cwd={cwd}
        branch={branch}
        repoName={repoName}
        submitting={remoteBusy === "push"}
        outcome={pushOutcome}
        onClose={onClose}
        onRun={(req, label) => onRun("push", req, label)}
      />
    );
  }
  return (
    <PullDialog
      cwd={cwd}
      branch={branch}
      repoName={repoName}
      submitting={remoteBusy === "pull"}
      onClose={onClose}
      onRun={(req, label) => onRun("pull", req, label)}
    />
  );
}

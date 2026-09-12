/**
 * GitPanel 横条件 —— 自 GitPanel.tsx 拆出(文件规模铁则)。
 * GitRemoteBar = 聚合行(分支 → upstream · ⟳ 刷新 + fetch/pull/push 语义图标,点击开对话框,
 * behind/ahead 计数上按钮);SmartSwitchUndoBanner = 「暂存并切换」冲突还原横幅
 * (确认框自带,GitConfirmDialog 是 fixed portal,挂此处不影响层级)。
 */

import { useState } from "react";
import { t } from "@kernel/i18n";
import { ArrowClockwise, CloudArrowDown, DownloadSimple, CircleNotch, UploadSimple } from "@phosphor-icons/react";
import { ipc, type GitAheadBehind, type GitRemoteRequest } from "@kernel/ipc";
import { gitErrorDisplay } from "../gitError";
import { clearSmartSwitchOrigin } from "../panelStore";
import { GitConfirmDialog, type GitConfirmState } from "./GitConfirmDialog";
import { bumpGitRefresh, useGitPanelState } from "../panelStore";

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
  const { refreshing } = useGitPanelState();
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-(--tmd-border) px-2 text-(--tmd-fg-muted)">
      <span className="shrink-0 font-medium text-(--tmd-fg)">{branch ?? "…"}</span>
      {upstream && (
        <span className="min-w-0 truncate text-(--tmd-fg-faint)">→ {upstream}</span>
      )}
      <span className="flex-1" />
      <div className="flex items-center gap-0.5">
      <button
        onClick={bumpGitRefresh}
        title={t("刷新(重扫状态/分支/历史)")}
        className="rounded p-1 hover:bg-(--tmd-bg-hover)"
      >
        <ArrowClockwise
          className={`h-3.5 w-3.5${refreshing ? " animate-spin" : ""}`}
          aria-hidden
        />
      </button>
      <RemoteOpButtons
        remoteBusy={remoteBusy}
        detached={detached}
        aheadBehind={aheadBehind}
        hasUpstream={hasUpstream}
        onOpenDialog={onOpenDialog}
      />
      </div>
    </div>
  );
}

/** fetch/pull/push 语义图标按钮组(busy 转圈、behind/ahead 计数上按钮);
    自 GitRemoteBar 拆出降复杂度;三个按钮再各自成组件(复杂度铁则)。 */
function RemoteOpButtons(props: {
  remoteBusy: RemoteOp | null;
  detached: boolean;
  aheadBehind: GitAheadBehind | null;
  hasUpstream: boolean;
  onOpenDialog: (op: RemoteOp) => void;
}) {
  return (
    <>
      <FetchOpButton {...props} />
      <PullOpButton {...props} />
      <PushOpButton {...props} />
    </>
  );
}

function FetchOpButton({
  remoteBusy,
  detached,
  onOpenDialog,
}: {
  remoteBusy: RemoteOp | null;
  detached: boolean;
  onOpenDialog: (op: RemoteOp) => void;
}) {
  return (
    <button
      onClick={() => onOpenDialog("fetch")}
      disabled={remoteBusy !== null || detached}
      title={t("获取远端更新(fetch --all --prune,不动本地分支)")}
      className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
    >
      {remoteBusy === "fetch" ? (
        <CircleNotch className="h-[0.875rem] w-[0.875rem] animate-spin" />
      ) : (
        <CloudArrowDown className="h-[0.875rem] w-[0.875rem]" />
      )}
    </button>
  );
}

function PullOpButton({
  remoteBusy,
  detached,
  aheadBehind,
  onOpenDialog,
}: {
  remoteBusy: RemoteOp | null;
  detached: boolean;
  aheadBehind: GitAheadBehind | null;
  onOpenDialog: (op: RemoteOp) => void;
}) {
  return (
    <button
      onClick={() => onOpenDialog("pull")}
      disabled={remoteBusy !== null || detached}
      title={
        (aheadBehind?.behind ?? 0) > 0
          ? t("拉取远端更新(落后 {n} 个提交)", { n: aheadBehind!.behind })
          : t("拉取远端更新(对话框内可选远端与分支)")
      }
      className="flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-(--tmd-bg-hover) disabled:opacity-50"
    >
      {remoteBusy === "pull" ? (
        <CircleNotch className="h-[0.875rem] w-[0.875rem] animate-spin" />
      ) : (
        <DownloadSimple className="h-[0.875rem] w-[0.875rem]" />
      )}
      {(aheadBehind?.behind ?? 0) > 0 && aheadBehind!.behind}
    </button>
  );
}

function PushOpButton({
  remoteBusy,
  detached,
  aheadBehind,
  hasUpstream,
  onOpenDialog,
}: {
  remoteBusy: RemoteOp | null;
  detached: boolean;
  aheadBehind: GitAheadBehind | null;
  hasUpstream: boolean;
  onOpenDialog: (op: RemoteOp) => void;
}) {
  return (
    <button
      onClick={() => onOpenDialog("push")}
      disabled={remoteBusy !== null || detached}
      title={
        (aheadBehind?.ahead ?? 0) > 0 ? (
          hasUpstream ? (
            t("推送 {n} 个提交(对话框内可预览)", { n: aheadBehind!.ahead })
          ) : (
            t("推送 {n} 个提交并建立 upstream", { n: aheadBehind!.ahead })
          )
        ) : hasUpstream ? (
          t("推送(对话框内查看预览与选项)")
        ) : (
          t("推送新分支并建立 upstream")
        )
      }
      className="flex items-center gap-0.5 rounded px-1 py-0.5 text-(--tmd-accent) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
    >
      {remoteBusy === "push" ? (
        <CircleNotch className="h-[0.875rem] w-[0.875rem] animate-spin" />
      ) : (
        <UploadSimple className="h-[0.875rem] w-[0.875rem]" />
      )}
      {(aheadBehind?.ahead ?? 0) > 0 && aheadBehind!.ahead}
    </button>
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

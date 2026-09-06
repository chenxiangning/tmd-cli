/**
 * GitPanel —— 右栏 Git 单视图面板(布局契约:proposal §1.3 / design §8)。
 *
 * 视图切换与刷新在顶栏 GitToolbar(filePanel toolbar 槽);状态共享走 panelStore。
 * cwd 自取活跃 workspace(外壳零改动,与 files 插件同模式)。
 * commit 执行权唯一入口:DiffView 的「✓ 提交」按钮。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaces } from "@kernel/workspace";
import { host } from "@kernel/host";
import { spinRemainder } from "@kernel/spin";
import { ipc, type GitAheadBehind, type GitRemoteRequest } from "@kernel/ipc";
import { useGitStatus } from "./hooks/useGitStatus";
import { useGitTotals } from "./hooks/useGitTotals";
import { useGitBranches } from "./hooks/useGitBranches";
import { useGitLog } from "./hooks/useGitLog";
import { gitErrorDisplay, isAuth } from "./gitError";
import { GIT_PREFILL_TOPIC, type GitPrefillPayload } from "./gitEvents";
import {
  clearRemoteDialogRequest,
  setGitAggregate,
  setGitView,
  setGitRefreshing,
  useGitPanelState,
  getSmartSwitchOrigin,
  clearSmartSwitchOrigin,
} from "./panelStore";
import { PushDialog } from "./views/remoteDialogs/PushDialog";
import { PullDialog } from "./views/remoteDialogs/PullDialog";
import { FetchDialog } from "./views/remoteDialogs/FetchDialog";
import { DiffView } from "./views/DiffView";
import { BranchView } from "./views/BranchView";
import { HistoryView } from "./views/HistoryView";
import { Cross } from "@phosphor-icons/react";
import { GitRemoteBar, SmartSwitchUndoBanner } from "./views/GitPanelBars";

export function GitPanel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const cwd = active?.root ?? null;

  const { view, layout, refreshNonce, remoteDialogRequest } = useGitPanelState();
  const [prefill, setPrefill] = useState<{ message: string; seq: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<"push" | "pull" | "fetch" | null>(null);
  const [dialog, setDialog] = useState<GitRemoteRequest["op"] | null>(null);
  /* 分支右键菜单「推送...」等入口请求打开远端对话框:消费即清,nonce 防重复。 */
  useEffect(() => {
    if (!remoteDialogRequest) return;
    clearRemoteDialogRequest();
    setDialog(remoteDialogRequest.op);
  }, [remoteDialogRequest]);

  const status = useGitStatus(cwd);
  const totals = useGitTotals(cwd);
  const branches = useGitBranches(cwd, view === "branch");
  const log = useGitLog(cwd, view === "history");

  const [aheadBehind, setAheadBehind] = useState<GitAheadBehind | null>(null);
  const aheadTokenRef = useRef(0);
  const refreshAheadBehind = useCallback(() => {
    if (!cwd) return Promise.resolve();
    const myToken = ++aheadTokenRef.current;
    return ipc.gitAheadBehind(cwd).then(
      (ab) => {
        if (myToken === aheadTokenRef.current) setAheadBehind(ab);
      },
      () => {
        if (myToken === aheadTokenRef.current) setAheadBehind(null);
      },
    );
  }, [cwd]);
  useEffect(() => {
    void refreshAheadBehind();
  }, [refreshAheadBehind, status.data?.branch]);

  /* 聚合数字上顶栏:totals + 文件数镜像进 panelStore,GitToolbar 只读消费。 */
  const totalsData = totals.data;
  const fileCount = status.data?.files?.length ?? 0;
  useEffect(() => {
    setGitAggregate({ totals: totalsData, fileCount });
  }, [totalsData, fileCount]);
  /* 冲突消失(未经 undo)→ 清除来源:横幅只准在「暂存并切换」冲突存续期出现,
   * 防陈旧 origin 在日后无关冲突(乃至其他仓库)里复活 reset --hard 级还原。
   * 必须挂在提前 return 之前:notARepo/cwd 翻转会让 GitPanel 走空态分支,
   * 钩子数变化 = React 卸整树白屏(实测踩过)。 */
  const undoOrigin = getSmartSwitchOrigin();
  useEffect(() => {
    if (undoOrigin && !(status.data?.files ?? []).some((f) => f.status === "C")) {
      clearSmartSwitchOrigin();
    }
  }, [undoOrigin, status.data?.files]);
  // composer `/commit <msg>` → 预填提交框并切差异视图(仅预填,执行权在提交按钮)
  useEffect(
    () =>
      host.events.on<GitPrefillPayload>(GIT_PREFILL_TOPIC, (p) => {
        setGitView("diff");
        setPrefill({ message: p.message, seq: Date.now() });
      }),
    [],
  );

  /** 刷新批次号:快速连点 ⟳ 时,旧批次 settle 不得提前熄掉新批次的转圈。 */
  const refreshBatchRef = useRef(0);

  const afterMutation = useCallback(() => {
    const jobs: Promise<unknown>[] = [status.refresh(), totals.refresh(), refreshAheadBehind()];
    if (view === "branch") jobs.push(branches.refresh());
    if (view === "history") jobs.push(log.refresh());
    /* 全部拉取 settle 才关 ⟳ 转圈;失败也算完成,绝不留常转。 */
    const myBatch = ++refreshBatchRef.current;
    setGitRefreshing(true);
    void Promise.allSettled(jobs).then(() => {
      if (refreshBatchRef.current === myBatch) setGitRefreshing(false);
    });
  }, [status, totals, refreshAheadBehind, view, branches, log]);

  // 顶栏 ⟳ → 全量刷新
  const lastNonceRef = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce !== lastNonceRef.current) {
      lastNonceRef.current = refreshNonce;
      afterMutation();
    }
  }, [refreshNonce, afterMutation]);

  /** 对话框执行链:关对话框 → 顶栏按钮转圈 → 成功通知+全量刷新 / 失败通知。
   *  凭据失败引导幕布终端(与右键菜单快速操作同一纪律)。 */
  const runDialog = useCallback(
    (op: GitRemoteRequest["op"], req: GitRemoteRequest, opLabel: string) => {
      if (!cwd || remoteBusy) return;
      setDialog(null);
      setRemoteBusy(op);
      setNotice(null);
      /* 转圈兜底:数据再快也转满一圈(kernel/spin),否则用户以为没点上。 */
      const startedAt = Date.now();
      const finishSpin = () => setRemoteBusy(null);
      ipc.gitRemoteRequest(cwd, req).then(
        () => {
          const wait = spinRemainder(startedAt);
          if (wait > 0) setTimeout(finishSpin, wait);
          else finishSpin();
          setNotice(`${opLabel}成功。`);
          afterMutation();
        },
        (e: unknown) => {
          const wait = spinRemainder(startedAt);
          if (wait > 0) setTimeout(finishSpin, wait);
          else finishSpin();
          setNotice(
            isAuth(e)
              ? `${opLabel}失败:凭据需要交互,请到幕布终端执行 git ${op}`
              : `${opLabel}失败。 ${gitErrorDisplay(e)} 可重试该操作。`,
          );
        },
      );
    },
    [cwd, remoteBusy, afterMutation],
  );

  if (!cwd || status.notARepo) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-(--tmd-fg-faint)">
        当前目录不是 Git 仓库
      </div>
    );
  }

  const files = status.data?.files ?? [];
  /* 远端三按钮:打开对应对话框(preview/选项/解释在对话框内);
   * detached HEAD 不参与远端按钮。无 upstream 也能拉取/推送(对话框可显式选目标)。 */
  const branchName = status.data?.branch ?? "";
  const detached = !branchName || branchName.startsWith("detached@");
  const hasUpstream = status.data?.upstream != null;
  const canUndo =
    files.some((f) => f.status === "C") && undoOrigin != null && undoOrigin.cwd === cwd;
  return (
    <div className="flex h-full flex-col text-xs">
      <GitRemoteBar
        branch={status.data?.branch}
        upstream={status.data?.upstream}
        remoteBusy={remoteBusy}
        detached={detached}
        aheadBehind={aheadBehind}
        hasUpstream={hasUpstream}
        onOpenDialog={setDialog}
      />

      {notice && (
        <div className="flex shrink-0 items-start gap-1 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1 text-(--tmd-fg-muted)">
          <span className="min-w-0 flex-1 break-words">{notice}</span>
          <button
            onClick={() => setNotice(null)}
            title="关闭"
            className="rounded p-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover)"
          >
            <Cross className="h-3 w-3" aria-hidden />
          </button>
        </div>
      )}
      {status.error && (
        <div className="shrink-0 border-b border-(--tmd-border) bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {gitErrorDisplay(status.error)}
        </div>
      )}
      {canUndo && undoOrigin != null && (
        <SmartSwitchUndoBanner
          cwd={cwd}
          undoOrigin={undoOrigin}
          onNotice={setNotice}
          afterMutation={afterMutation}
        />
      )}

      <div className="min-h-0 flex-1">
        {view === "diff" && (
          <DiffView
            cwd={cwd}
            layout={layout}
            files={files}
            totals={totals.data}
            prefill={prefill}
            onMutation={afterMutation}
          />
        )}
        {view === "branch" && (
          <BranchView
            cwd={cwd}
            data={branches.data}
            loading={branches.loading}
            currentName={status.data?.branch}
            dirty={files.length > 0}
            onMutation={afterMutation}
          />
        )}
        {view === "history" && cwd && (
          <HistoryView
            log={log}
            cwd={cwd}
            branch={status.data?.branch ?? ""}
            upstream={status.data?.upstream ?? null}
            ahead={aheadBehind?.ahead ?? 0}
            behind={aheadBehind?.behind ?? 0}
          />
        )}
      </div>
      {cwd && dialog === "push" && (
        <PushDialog
          cwd={cwd}
          branch={branchName}
          submitting={remoteBusy === "push"}
          onClose={() => setDialog(null)}
          onRun={(req, label) => runDialog("push", req, label)}
        />
      )}
      {cwd && dialog === "pull" && (
        <PullDialog
          cwd={cwd}
          branch={branchName}
          submitting={remoteBusy === "pull"}
          onClose={() => setDialog(null)}
          onRun={(req, label) => runDialog("pull", req, label)}
        />
      )}
      {cwd && dialog === "fetch" && (
        <FetchDialog
          submitting={remoteBusy === "fetch"}
          onClose={() => setDialog(null)}
          onRun={(req, label) => runDialog("fetch", req, label)}
        />
      )}
    </div>
  );
}

/**
 * GitPanel —— 右栏 Git 单视图面板(布局契约:proposal §1.3 / design §8)。
 *
 * 视图切换与刷新在顶栏 GitToolbar(filePanel toolbar 槽);状态共享走 panelStore。
 * cwd 自取活跃 workspace(外壳零改动,与 files 插件同模式)。
 * commit 执行权唯一入口:DiffView 的「✓ 提交」按钮。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, Loader2 } from "lucide-react";
import { useWorkspaces } from "@kernel/workspace";
import { host } from "@kernel/host";
import { ipc, type GitAheadBehind } from "@kernel/ipc";
import { useGitStatus } from "./hooks/useGitStatus";
import { useGitTotals } from "./hooks/useGitTotals";
import { useGitBranches } from "./hooks/useGitBranches";
import { useGitLog } from "./hooks/useGitLog";
import { gitErrorDisplay, isAuth } from "./gitError";
import { GIT_PREFILL_TOPIC, type GitPrefillPayload } from "./gitEvents";
import { setGitView, setGitRefreshing, useGitPanelState } from "./panelStore";
import { DiffView } from "./views/DiffView";
import { BranchView } from "./views/BranchView";
import { HistoryView } from "./views/HistoryView";

export function GitPanel() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const cwd = active?.root ?? null;

  const { view, layout, refreshNonce } = useGitPanelState();
  const [notice, setNotice] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<{ message: string; seq: number } | null>(null);
  const [remoteBusy, setRemoteBusy] = useState<"push" | "pull" | "fetch" | null>(null);

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

  /** 远端操作统一入口:fetch/pull/push 共用 busy 与通知;凭据失败引导幕布终端。 */
  const runRemote = useCallback(
    (op: "push" | "pull" | "fetch") => {
      if (!cwd || remoteBusy) return;
      setRemoteBusy(op);
      setNotice(null);
      const request = op === "fetch" ? ipc.gitFetch(cwd) : ipc.gitPullPush(cwd, op);
      request.then(
        () => {
          setRemoteBusy(null);
          setNotice(`${op} 完成`);
          afterMutation();
        },
        (e: unknown) => {
          setRemoteBusy(null);
          setNotice(
            isAuth(e)
              ? `凭据需要交互,请到幕布终端执行 git ${op}`
              : gitErrorDisplay(e),
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

  return (
    <div className="flex h-full flex-col text-xs">
      {/* 聚合行:分支 · 文件数 · fetch/pull/push */}
      <div className="flex h-7 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-(--tmd-border) px-2 text-(--tmd-fg-muted)">
        <span className="shrink-0 font-medium text-(--tmd-fg)">{status.data?.branch ?? "…"}</span>
        {status.data?.upstream && (
          <span className="min-w-0 truncate text-(--tmd-fg-faint)">→ {status.data.upstream}</span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 tabular-nums" title="聚合增删行数(staged + 未暂存)">
          <span className="text-(--tmd-diff-inserted)">
            +{(totals.data?.insertions ?? 0).toLocaleString("en-US")}
          </span>
          <span className="mx-1 text-(--tmd-fg-faint)">/</span>
          <span className="text-(--tmd-diff-removed)">
            -{(totals.data?.deletions ?? 0).toLocaleString("en-US")}
          </span>
        </span>
        <span className="shrink-0">{files.length} 文件</span>
        <button
          onClick={() => runRemote("fetch")}
          disabled={remoteBusy !== null}
          title="fetch --all --prune(更新远端引用,不动本地分支)"
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
        >
          {remoteBusy === "fetch" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={() => runRemote("pull")}
          disabled={remoteBusy !== null}
          title={
            (aheadBehind?.behind ?? 0) > 0
              ? `pull(落后 ${aheadBehind!.behind} 个提交)`
              : "pull(跟随上游与 pull.rebase 配置)"
          }
          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
        >
          {remoteBusy === "pull" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowDown className="h-3.5 w-3.5" />
          )}
          {(aheadBehind?.behind ?? 0) > 0 && aheadBehind!.behind}
        </button>
        {(aheadBehind?.ahead ?? 0) > 0 && (
          <button
            onClick={() => runRemote("push")}
            disabled={remoteBusy !== null}
            title={`push ${aheadBehind!.ahead} 个提交`}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-(--tmd-accent) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
          >
            {remoteBusy === "push" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" />
            )}
            {aheadBehind!.ahead}
          </button>
        )}
      </div>

      {notice && (
        <div className="shrink-0 border-b border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1 text-(--tmd-fg-muted)">
          {notice}
        </div>
      )}
      {status.error && (
        <div className="shrink-0 border-b border-(--tmd-border) bg-(--tmd-bg-sunken) px-2 py-1 text-(--tmd-diff-removed)">
          {gitErrorDisplay(status.error)}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {view === "diff" && (
          <DiffView
            cwd={cwd}
            layout={layout}
            files={files}
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
    </div>
  );
}

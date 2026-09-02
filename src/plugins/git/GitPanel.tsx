/**
 * GitPanel —— 右栏 Git 单视图面板(布局契约:proposal §1.3 / design §8)。
 *
 * 视图切换与刷新在顶栏 GitToolbar(filePanel toolbar 槽);状态共享走 panelStore。
 * cwd 自取活跃 workspace(外壳零改动,与 files 插件同模式)。
 * commit 执行权唯一入口:DiffView 的「✓ 提交」按钮。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2 } from "lucide-react";
import { useWorkspaces } from "@kernel/workspace";
import { host } from "@kernel/host";
import { ipc, type GitAheadBehind } from "@kernel/ipc";
import { useGitStatus } from "./hooks/useGitStatus";
import { useGitTotals } from "./hooks/useGitTotals";
import { useGitDiffs } from "./hooks/useGitDiffs";
import { useGitBranches } from "./hooks/useGitBranches";
import { useGitLog } from "./hooks/useGitLog";
import { gitErrorDisplay, isAuth } from "./gitError";
import { GIT_PREFILL_TOPIC, type GitPrefillPayload } from "./gitEvents";
import { setGitView, useGitPanelState } from "./panelStore";
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
  const [pushBusy, setPushBusy] = useState(false);

  const status = useGitStatus(cwd);
  const totals = useGitTotals(cwd);
  /* 幕布外改动签名:headSha + 文件集。变化 = 仓库被面板之外途径改动,
     useGitDiffs 据此作废 patch 缓存并重拉展开项,抽屉不显示陈旧 diff。 */
  const statusSignature = status.data
    ? `${status.data.headSha}|${status.data.files
        .map((f) => `${f.path}:${f.status}${f.staged ? "s" : ""}${f.wt ? "w" : ""}`)
        .join(",")}`
    : null;
  const diffs = useGitDiffs(cwd, statusSignature);
  const branches = useGitBranches(cwd, view === "branch");
  const log = useGitLog(cwd, view === "history");

  const [aheadBehind, setAheadBehind] = useState<GitAheadBehind | null>(null);
  const aheadTokenRef = useRef(0);
  const refreshAheadBehind = useCallback(() => {
    if (!cwd) return;
    const myToken = ++aheadTokenRef.current;
    ipc.gitAheadBehind(cwd).then(
      (ab) => {
        if (myToken === aheadTokenRef.current) setAheadBehind(ab);
      },
      () => {
        if (myToken === aheadTokenRef.current) setAheadBehind(null);
      },
    );
  }, [cwd]);
  useEffect(refreshAheadBehind, [refreshAheadBehind, status.data?.branch]);

  // composer `/commit <msg>` → 预填提交框并切差异视图(仅预填,执行权在提交按钮)
  useEffect(
    () =>
      host.events.on<GitPrefillPayload>(GIT_PREFILL_TOPIC, (p) => {
        setGitView("diff");
        setPrefill({ message: p.message, seq: Date.now() });
      }),
    [],
  );

  const afterMutation = useCallback(() => {
    status.refresh();
    totals.refresh();
    diffs.invalidate();
    refreshAheadBehind();
    if (view === "branch") branches.refresh();
    if (view === "history") log.refresh();
  }, [status, totals, diffs, refreshAheadBehind, view, branches, log]);

  // 顶栏 ⟳ → 全量刷新
  const lastNonceRef = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce !== lastNonceRef.current) {
      lastNonceRef.current = refreshNonce;
      afterMutation();
    }
  }, [refreshNonce, afterMutation]);

  const pushAhead = useCallback(() => {
    if (!cwd || pushBusy) return;
    setPushBusy(true);
    setNotice(null);
    ipc.gitPullPush(cwd, "push").then(
      () => {
        setPushBusy(false);
        setNotice("push 完成");
        afterMutation();
      },
      (e: unknown) => {
        setPushBusy(false);
        setNotice(
          isAuth(e)
            ? "凭据需要交互,请到幕布终端执行 git push"
            : gitErrorDisplay(e),
        );
      },
    );
  }, [cwd, pushBusy, afterMutation]);

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
      {/* 聚合行:分支 · 文件数 · ahead/push */}
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
        {(aheadBehind?.ahead ?? 0) > 0 && (
          <button
            onClick={pushAhead}
            disabled={pushBusy}
            title={`push ${aheadBehind!.ahead} 个提交`}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-(--tmd-accent) hover:bg-(--tmd-bg-hover) disabled:opacity-50"
          >
            {pushBusy ? (
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
            diffs={diffs}
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
        {view === "history" && <HistoryView log={log} />}
      </div>
    </div>
  );
}

/**
 * GitPanel 数据编排钩子 —— 状态/总数/分支/日志四源 + ahead-behind + 聚合镜像 +
 * 提交预填监听 + afterMutation 全量刷新(no-high-complexity 降分支):
 * 面板组件只留多仓守卫与渲染编排;派生展示值(branch/upstream/detached 等)
 * 在此一并算好,GitPanelMain 零派生分支消费。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { host } from "@kernel/host";
import { ipc, type GitAheadBehind } from "@kernel/ipc";
import { useGitStatus } from "./hooks/useGitStatus";
import { useGitTotals } from "./hooks/useGitTotals";
import { useGitBranches } from "./hooks/useGitBranches";
import { useGitLog } from "./hooks/useGitLog";
import {
  setGitAggregate,
  setGitRefreshing,
  setGitView,
  useGitPanelState,
  getSmartSwitchOrigin,
  clearSmartSwitchOrigin,
} from "./panelStore";
import { GIT_PREFILL_TOPIC, type GitPrefillPayload } from "./gitEvents";

export function useGitPanelData(cwd: string | null, refreshRepos: () => Promise<void>) {
  const { view, layout, refreshNonce } = useGitPanelState();
  const [prefill, setPrefill] = useState<{ message: string; seq: number } | null>(null);

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
  const files = status.data?.files ?? [];
  const totalsData = totals.data;
  const fileCount = files.length;
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
    () => {
      const off = host.events.on<GitPrefillPayload>(GIT_PREFILL_TOPIC, (p) => {
        setGitView("diff");
        setPrefill({ message: p.message, seq: Date.now() });
      });
      return () => off();
    },
    [],
  );

  /** 刷新批次号:快速连点 ⟳ 时,旧批次 settle 不得提前熄掉新批次的转圈。 */
  const refreshBatchRef = useRef(0);
  /** 仓 chips 轻量状态的刷新批号:发现周期外,写操作后也拉一次(dirty/↑↓ 变化)。 */
  const [chipSeq, setChipSeq] = useState(0);

  const afterMutation = useCallback(() => {
    const jobs: Promise<unknown>[] = [status.refresh(), totals.refresh(), refreshAheadBehind(), refreshRepos()];
    if (view === "branch") jobs.push(branches.refresh());
    if (view === "history") jobs.push(log.refresh());
    /* 全部拉取 settle 才关 ⟳ 转圈;失败也算完成,绝不留常转。 */
    const myBatch = ++refreshBatchRef.current;
    setChipSeq((s) => s + 1);
    setGitRefreshing(true);
    void Promise.allSettled(jobs).then(() => {
      if (refreshBatchRef.current === myBatch) setGitRefreshing(false);
    });
  }, [status, totals, refreshAheadBehind, refreshRepos, view, branches, log]);

  // 顶栏 ⟳ → 全量刷新(与 afterMutation 同一套批次守卫;effect 直呼 hook 派生
  // 回调会命中 no-pass-data-to-parent 的闭包误判,故作业清单就地展开)
  const lastNonceRef = useRef(refreshNonce);
  useEffect(() => {
    if (refreshNonce === lastNonceRef.current) return;
    lastNonceRef.current = refreshNonce;
    const jobs: Promise<unknown>[] = [status.refresh(), totals.refresh(), refreshAheadBehind(), refreshRepos()];
    if (view === "branch") jobs.push(branches.refresh());
    if (view === "history") jobs.push(log.refresh());
    const myBatch = ++refreshBatchRef.current;
    setChipSeq((s) => s + 1);
    setGitRefreshing(true);
    void Promise.allSettled(jobs).then(() => {
      if (refreshBatchRef.current === myBatch) setGitRefreshing(false);
    });
  }, [refreshNonce, status, totals, refreshAheadBehind, refreshRepos, view, branches, log]);

  /* 派生展示值:远端条/分支视图吃原始 branch/upstream,对话框/历史吃兜底后的串。 */
  const branch = status.data?.branch;
  const branchName = branch ?? "";
  const upstream = status.data?.upstream;
  const detached = !branchName || branchName.startsWith("detached@");
  const hasUpstream = upstream != null;

  return {
    view,
    layout,
    status,
    totals,
    branches,
    log,
    files,
    branch,
    branchName,
    upstream,
    upstreamNull: upstream ?? null,
    detached,
    hasUpstream,
    undoOrigin,
    aheadBehind,
    chipSeq,
    prefill,
    afterMutation,
  };
}

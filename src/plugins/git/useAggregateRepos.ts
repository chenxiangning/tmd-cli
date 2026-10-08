/**
 * useAggregateRepos —— 聚合模式(「全部」)数据面:跨本机工作区的仓清单 + 轻量状态。
 * 取数纪律(spec 2026-10-08-git-batch-ops-design):进入聚合态/手动刷新/批量操作后
 * 各拉一次,不挂轮询(调研 §2.7:全仓高频轮询是反模式)。远程工作区(wsl.hostId)
 * 排除并计数——git2 内核原语只认本机路径,与 GitPanel 的远程降级同一依据。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitRepoSummary } from "@kernel/ipc";
import { setActiveWorkspace, useWorkspaces } from "@kernel/workspace";
import { SCAN_DEPTH } from "./hooks/useGitRepos";
import { setSelectedRepo } from "./panelStore";
import { canAggregate, dedupeGroups, type AggGroup } from "./aggregateModel";

/** 「本仓|全部」范围态 + 跳仓(GitPanel 复杂度治理:no-high-complexity-react-function)。 */
export function useAggregateScope(repos: readonly GitRepoSummary[]) {
  const { list } = useWorkspaces();
  const [scope, setScope] = useState<"repo" | "all">("repo");
  const showScope = canAggregate(list, repos.length);
  /* 点行跳仓:置选中仓 + 切工作区 + 退回本仓态,落地即该仓完整语境。 */
  const jumpToRepo = useCallback((wsId: string, path: string) => {
    setSelectedRepo(wsId, path);
    setActiveWorkspace(wsId);
    setScope("repo");
  }, []);
  return { scope, setScope, showScope, jumpToRepo };
}

interface AggregateState {
  groups: AggGroup[];
  /** 被排除的远程工作区数(>0 时视图底部一行说明)。 */
  remoteSkipped: number;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useAggregateRepos(): AggregateState {
  const { list } = useWorkspaces();
  const [groups, setGroups] = useState<AggGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(0);
  const local = list.filter((w) => !w.wsl?.hostId);
  const remoteSkipped = list.length - local.length;
  /* 签名串:工作区集合变化触发重拉;refresh 经 ref 读最新 local,保持引用稳定。 */
  const sig = local.map((w) => `${w.id}:${w.root}`).join("\n");
  const localRef = useRef(local);
  useEffect(() => {
    localRef.current = local;
  }, [local]);

  const refresh = useCallback(async () => {
    const local = localRef.current;
    const myToken = ++tokenRef.current;
    if (local.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const scans = await Promise.allSettled(
        local.map(async (ws) => ({
          wsId: ws.id,
          wsName: ws.alias?.trim() || ws.name,
          root: ws.root,
          ...(await ipc.gitReposScan(ws.root, SCAN_DEPTH)),
        })),
      );
      if (myToken !== tokenRef.current) return;
      const ok = scans.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
      const base = dedupeGroups(ok);
      const paths = base.flatMap((g) => g.repos.map((r) => r.path));
      const statusRows = paths.length > 0 ? await ipc.gitStatusBatch(paths).catch(() => []) : [];
      const statusByRoot = new Map(statusRows.map((r) => [r.root, r.status]));
      const abs = await Promise.allSettled(paths.map((p) => ipc.gitAheadBehind(p)));
      if (myToken !== tokenRef.current) return;
      const abByPath = new Map(paths.map((p, i) => [p, abs[i]] as const));
      setGroups(
        base.map((g) => ({
          ...g,
          repos: g.repos.map((r) => {
            const st = statusByRoot.get(r.path);
            const ab = abByPath.get(r.path);
            return {
              ...r,
              branch: st?.branch || r.branch,
              dirty: st ? st.files.length : -1,
              ahead: ab?.status === "fulfilled" ? ab.value.ahead : 0,
              behind: ab?.status === "fulfilled" ? ab.value.behind : 0,
              upstream: ab?.status === "fulfilled" ? ab.value.upstream : null,
            };
          }),
        })),
      );
    } finally {
      if (myToken === tokenRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [sig, refresh]);

  return { groups, remoteSkipped, loading, refresh };
}

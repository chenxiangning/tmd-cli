/**
 * ports · 行数据派生 hook —— 家族归组/搜索过滤/列头排序/可见行数/会话归因/进程计数,
 * 输入 = 扫描结果 + 过滤词 + 排序规格,输出直缝 RowCtx 与工具栏。纯派生无 IO。
 */

import { useMemo } from "react";
import { host } from "@kernel/host";
import { findOwnerSession, groupByFamily, rowKey, sortGroups } from "./portsTree";
import type { OwnerSession, PortEntry, PortGroup, ScanOutcome, SortSpec } from "./types";

export interface PortRows {
  groups: PortGroup[];
  filtered: PortGroup[];
  shownRows: number;
  ownerByRow: Map<string, OwnerSession | null>;
  procCount: number;
}

export function usePortRows(
  outcome: ScanOutcome | null,
  filter: string,
  sort: SortSpec | null,
  wsNames: Map<string, string>,
): PortRows {
  const groups = useMemo(() => {
    const g = outcome ? groupByFamily(outcome.rows) : [];
    return sort ? sortGroups(g, sort, wsNames) : g;
  }, [outcome, sort, wsNames]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return groups;
    const hit = (r: PortEntry) =>
      [String(r.port), r.pid != null ? String(r.pid) : "", r.process, r.args, r.addr, r.cwd ?? "", r.gitRoot ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    return groups
      .map((g) => ({ top: g.top, children: g.children.filter(hit) }))
      .filter((g) => hit(g.top) || g.children.length > 0);
  }, [groups, filter]);

  const shownRows = useMemo(() => filtered.reduce((n, g) => n + 1 + g.children.length, 0), [filtered]);

  const ownerByRow = useMemo(() => {
    const m = new Map<string, OwnerSession | null>();
    if (!outcome) return m;
    const sessionByPid = new Map<number, OwnerSession>();
    for (const s of host.getSessions()) {
      if (s.pid != null)
        sessionByPid.set(s.pid, { id: s.id, title: s.title, profileId: s.profileId, workspaceId: s.workspaceId });
    }
    const ppidOf = (p: number) => outcome.ppidAll.get(p) ?? null;
    for (const r of outcome.rows) m.set(rowKey(r), findOwnerSession(r.pid, ppidOf, sessionByPid));
    return m;
  }, [outcome]);

  const procCount = useMemo(
    () => (outcome ? new Set(outcome.rows.map((r) => r.pid).filter((p) => p != null)).size : 0),
    [outcome],
  );

  return { groups, filtered, shownRows, ownerByRow, procCount };
}

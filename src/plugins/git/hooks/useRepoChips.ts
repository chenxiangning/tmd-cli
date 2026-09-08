/**
 * useRepoChips —— 仓 chips / 引导行的轻量状态(branch + dirty 数 + ahead/behind)。
 * 取数纪律(spec §3):选中仓之外不上 5s 轮询,仅在发现周期(repos 变化)、
 * 写操作后(seq bump)、挂载时拉取;失败仓给缺省(数字不显示)。
 */

import { useEffect, useRef, useState } from "react";
import { ipc, type GitRepoSummary } from "@kernel/ipc";

export interface RepoChipState {
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  upstream: string | null;
}

/** repos 签名串:路径集合变化才重拉,同集合 seq bump 不重建请求键。 */
function signature(repos: readonly GitRepoSummary[]): string {
  return repos.map((r) => r.path).join("\n");
}

export function useRepoChips(
  repos: readonly GitRepoSummary[],
  seq: number,
): ReadonlyMap<string, RepoChipState> {
  const [chips, setChips] = useState<ReadonlyMap<string, RepoChipState>>(new Map());
  const tokenRef = useRef(0);
  const sig = signature(repos);

  useEffect(() => {
    const myToken = ++tokenRef.current;
    if (repos.length === 0) {
      setChips(new Map());
      return;
    }
    void Promise.allSettled(
      repos.map(async (r) => {
        const [st, ab] = await Promise.allSettled([
          ipc.gitStatus(r.path),
          ipc.gitAheadBehind(r.path),
        ]);
        return [r.path, {
          branch: st.status === "fulfilled" ? st.value.branch : r.branch,
          dirty: st.status === "fulfilled" ? st.value.files.length : -1,
          ahead: ab.status === "fulfilled" ? ab.value.ahead : 0,
          behind: ab.status === "fulfilled" ? ab.value.behind : 0,
          upstream: ab.status === "fulfilled" ? ab.value.upstream : null,
        }] as const;
      }),
    ).then((rows) => {
      if (myToken !== tokenRef.current) return;
      const next = new Map<string, RepoChipState>();
      for (const row of rows) {
        if (row.status === "fulfilled") next.set(row.value[0], row.value[1]);
      }
      setChips(next);
    });
    /* sig 而非 repos 依赖:对象引用每次扫描都变,签名词判防抖 */
  }, [sig, seq, repos.length]);

  return chips;
}

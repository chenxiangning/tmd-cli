/**
 * useGitTotals —— cwd 维度的聚合 ±行数(staged + unstaged 求和)。
 *
 * 取数纪律(proposal §2.7):totals 是全仓 diff×2 + 全量读文件计行的重操作,
 * 与 ahead/behind 同为低频命令 —— 不挂 5s 轮询,只在 60s 慢巡航、窗口转可见、
 * 以及写操作后显式 refresh() 时拉取。5s 轮询由 useGitStatus 负责文件清单。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitTotals } from "@kernel/ipc";

const SLOW_POLL_MS = 60_000;

export interface GitTotalsState {
  data: GitTotals | null;
  /** 返回在途 promise,调用方据此驱动「刷新中」反馈(如顶栏 ⟳ 转圈)。 */
  refresh: () => Promise<void>;
}

export function useGitTotals(cwd: string | null): GitTotalsState {
  const [data, setData] = useState<GitTotals | null>(null);
  const tokenRef = useRef(0);

  const refresh = useCallback(() => {
    const myToken = ++tokenRef.current;
    if (!cwd) {
      setData(null);
      return Promise.resolve();
    }
    return ipc.gitTotals(cwd).then(
      (next) => {
        if (myToken === tokenRef.current) setData(next);
      },
      () => {
        /* totals 拉取失败不打断面板:聚合行展示为 0 */
        if (myToken === tokenRef.current) setData(null);
      },
    );
  }, [cwd]);

  useEffect(() => {
    setData(null);
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, SLOW_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { data, refresh };
}

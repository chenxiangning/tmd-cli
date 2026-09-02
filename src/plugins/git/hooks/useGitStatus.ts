/**
 * useGitStatus —— cwd 维度的工作区状态。
 *
 * 刷新策略(proposal §2.7):5s 轮询 + visibilitychange 失焦暂停 + 显式 refresh()。
 * 写操作后调用方必须 refresh() 立即拉新;ahead/behind 不在此(独立低频 hook)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitDiffStatus } from "@kernel/ipc";
import { gitErrorMessage, isNotARepo } from "../gitError";

const POLL_MS = 5000;

export interface GitStatusState {
  data: GitDiffStatus | null;
  loading: boolean;
  error: string | null;
  notARepo: boolean;
  /** 返回在途 promise,调用方据此驱动「刷新中」反馈(如顶栏 ⟳ 转圈)。 */
  refresh: () => Promise<void>;
}

export function useGitStatus(cwd: string | null): GitStatusState {
  const [state, setState] = useState<Omit<GitStatusState, "refresh">>({
    data: null,
    loading: true,
    error: null,
    notARepo: false,
  });
  const tokenRef = useRef(0);

  const refresh = useCallback(() => {
    // 无条件 bump:null cwd 分支也要作废旧 cwd 的在途响应
    const myToken = ++tokenRef.current;
    if (!cwd) {
      setState({ data: null, loading: false, error: null, notARepo: true });
      return Promise.resolve();
    }
    return ipc.gitStatus(cwd).then(
      (data) => {
        if (myToken !== tokenRef.current) return; // cwd 已切换,丢弃过期响应
        setState({ data, loading: false, error: null, notARepo: false });
      },
      (e: unknown) => {
        if (myToken !== tokenRef.current) return;
        setState({
          data: null,
          loading: false,
          error: gitErrorMessage(e),
          notARepo: isNotARepo(e),
        });
      },
    );
  }, [cwd]);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { ...state, refresh };
}

/**
 * useGitRepos —— workspace 根的多仓发现(spec 2026-09-07-git-multi-repo-design §3)。
 * 取数纪律(对齐 useGitTotals):发现是有界 BFS 重操作,不挂 5s 轮询 ——
 * 仅 root 切换、60s 慢巡航、窗口转可见、显式 refresh()(顶栏 ⟳ / 写操作后)时拉取。
 * 扫描失败(根不可访问等)= 空列表,面板自然落到 guide/empty 档,不弹错误。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitRepoSummary } from "@kernel/ipc";

const SLOW_POLL_MS = 60_000;
/** 发现 BFS 深度(前端传参,Rust 默认同值);RepoGuide 引导文案同步显示。 */
export const SCAN_DEPTH = 2;

interface GitReposState {
  repos: GitRepoSummary[];
  truncated: boolean;
  /** 返回在途 promise,调用方据此把它并进「刷新中」批次(顶栏 ⟳ 转圈)。 */
  refresh: () => Promise<void>;
}

export function useGitRepos(root: string | null): GitReposState {
  const [state, setState] = useState<{ repos: GitRepoSummary[]; truncated: boolean }>({
    repos: [],
    truncated: false,
  });
  const tokenRef = useRef(0);

  const refresh = useCallback(() => {
    // 无条件 bump:root 翻空时作废旧根的在途响应
    const myToken = ++tokenRef.current;
    if (!root) {
      setState({ repos: [], truncated: false });
      return Promise.resolve();
    }
    return ipc.gitReposScan(root, SCAN_DEPTH).then(
      (out) => {
        if (myToken === tokenRef.current) setState({ repos: out.repos, truncated: out.truncated });
      },
      () => {
        if (myToken === tokenRef.current) setState({ repos: [], truncated: false });
      },
    );
  }, [root]);

  useEffect(() => {
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

  return { ...state, refresh };
}

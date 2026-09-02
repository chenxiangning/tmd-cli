/**
 * useGitLog —— 历史视图激活才拉;分页 append(loadMore)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitLogEntry } from "@kernel/ipc";
import { gitErrorMessage } from "../gitError";

const PAGE_SIZE = 50;

export interface GitLogState {
  entries: GitLogEntry[];
  loading: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => void;
  refresh: () => void;
}

export function useGitLog(cwd: string | null, active: boolean): GitLogState {
  const [entries, setEntries] = useState<GitLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef(0);

  const load = useCallback(
    (offset: number, replace: boolean) => {
      if (!cwd) return;
      const myToken = ++tokenRef.current;
      setLoading(true);
      ipc.gitLog(cwd, PAGE_SIZE, offset).then(
        (page) => {
          if (myToken !== tokenRef.current) return;
          setEntries((prev) => (replace ? page : [...prev, ...page]));
          setHasMore(page.length === PAGE_SIZE);
          setLoading(false);
          setError(null);
        },
        (e: unknown) => {
          if (myToken !== tokenRef.current) return;
          setError(gitErrorMessage(e));
          setLoading(false);
        },
      );
    },
    [cwd],
  );

  const refresh = useCallback(() => load(0, true), [load]);
  const loadMore = useCallback(() => {
    if (!loading && hasMore) load(entries.length, false);
  }, [entries.length, hasMore, load, loading]);

  /* cwd 重置 effect 必须先于取数 effect 声明:两 effect 按声明序执行,
     先 bump 掉旧 cwd 在途响应,refresh 发出的新请求 token 才不被污染。
     反序时 mount/history 激活态切 workspace 会先发新请求再作废它 →
     loading 永远 true,历史视图只能靠切视图自救。 */
  useEffect(() => {
    tokenRef.current += 1; // 作废旧 cwd 在途 loadMore 响应
    setEntries([]);
    setHasMore(true);
    setError(null);
  }, [cwd]);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  return { entries, loading, hasMore, error, loadMore, refresh };
}

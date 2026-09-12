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
  /** 返回在途 promise,调用方据此驱动「刷新中」反馈(如顶栏 ⟳ 转圈)。 */
  refresh: () => Promise<void>;
}

interface PageState {
  cwd: string | null;
  entries: GitLogEntry[];
  hasMore: boolean;
  error: string | null;
}

/** cwd 切换后的空页视图(旧 cwd 数据不展示、不参与 append)。 */
const EMPTY_PAGE: Omit<PageState, "cwd"> = { entries: [], hasMore: true, error: null };

export function useGitLog(cwd: string | null, active: boolean): GitLogState {
  /* 分页数据与 cwd 同槽:cwd 一变即派生为空页,旧数据随下次写入整体覆盖,
     无需 cwd 重置 effect(原三件套 setEntries/setHasMore/setError)。 */
  const [page, setPage] = useState<PageState>({ cwd, ...EMPTY_PAGE });
  const [loading, setLoading] = useState(false);
  const tokenRef = useRef(0);

  const load = useCallback(
    (offset: number, replace: boolean) => {
      if (!cwd) return Promise.resolve();
      const myToken = ++tokenRef.current;
      setLoading(true);
      return ipc.gitLog(cwd, PAGE_SIZE, offset).then(
        (next) => {
          if (myToken !== tokenRef.current) return;
          setPage((prev) => ({
            cwd,
            entries: replace ? next : [...(prev.cwd === cwd ? prev.entries : []), ...next],
            hasMore: next.length === PAGE_SIZE,
            error: null,
          }));
          setLoading(false);
        },
        (e: unknown) => {
          if (myToken !== tokenRef.current) return;
          /* 错误路径同样要过 cwd 闸:切仓后首次拉取失败不得解封旧仓 entries/hasMore
             (成功路径 48 行与 loadMore 均有闸,此处曾漏——A 仓列表会出现在 B 仓错误横幅下)。 */
          setPage((prev) => ({
            cwd,
            entries: prev.cwd === cwd ? prev.entries : [],
            hasMore: prev.cwd === cwd ? prev.hasMore : true,
            error: gitErrorMessage(e),
          }));
          setLoading(false);
        },
      );
    },
    [cwd],
  );

  const refresh = useCallback(() => load(0, true), [load]);
  const view = page.cwd === cwd ? page : EMPTY_PAGE;
  const loadMore = useCallback(() => {
    if (!loading && view.hasMore) load(view.entries.length, false);
  }, [view.entries.length, view.hasMore, load, loading]);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  return { entries: view.entries, loading, hasMore: view.hasMore, error: view.error, loadMore, refresh };
}

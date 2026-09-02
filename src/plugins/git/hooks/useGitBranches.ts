/**
 * useGitBranches —— 分支视图激活时才拉取;写操作后 refresh()。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitBranchList } from "@kernel/ipc";
import { gitErrorMessage } from "../gitError";

export interface GitBranchesState {
  data: GitBranchList | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useGitBranches(cwd: string | null, active: boolean): GitBranchesState {
  const [state, setState] = useState<Omit<GitBranchesState, "refresh">>({
    data: null,
    loading: false,
    error: null,
  });
  const tokenRef = useRef(0);

  const refresh = useCallback(() => {
    if (!cwd) return;
    const myToken = ++tokenRef.current;
    setState((s) => ({ ...s, loading: true }));
    ipc.gitBranches(cwd).then(
      (data) => {
        if (myToken !== tokenRef.current) return;
        setState({ data, loading: false, error: null });
      },
      (e: unknown) => {
        if (myToken !== tokenRef.current) return;
        setState({ data: null, loading: false, error: gitErrorMessage(e) });
      },
    );
  }, [cwd]);

  useEffect(() => {
    if (active) refresh();
  }, [active, refresh]);

  return { ...state, refresh };
}

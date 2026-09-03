/**
 * useCommitFiles —— 单提交文件清单按需拉取 + 组件级缓存(每 sha 一份)。
 *
 * Graph 展开与提交 diff tab 共用:ensure(sha) 幂等,fetchedRef 去重
 * (在途/已成的 sha 不再请求);失败移出去重集,下次展开自动重试;
 * cwd 切换整体作废。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitCommitFile } from "@kernel/ipc";
import { gitErrorMessage } from "../gitError";

interface CommitFilesEntry {
  files: GitCommitFile[];
  loading: boolean;
  error: string | null;
}

export function useCommitFiles(cwd: string | null) {
  const [entries, setEntries] = useState<Record<string, CommitFilesEntry>>({});
  const fetchedRef = useRef(new Set<string>());
  const tokenRef = useRef(0);

  // cwd 切换:整体作废(路径空间已变)
  useEffect(() => {
    tokenRef.current += 1;
    fetchedRef.current.clear();
    setEntries({});
  }, [cwd]);

  const ensure = useCallback(
    (sha: string) => {
      if (!cwd || sha.startsWith("scm-graph-")) return;
      if (fetchedRef.current.has(sha)) return;
      fetchedRef.current.add(sha);
      const myToken = ++tokenRef.current;
      setEntries((prev) => ({
        ...prev,
        [sha]: { files: prev[sha]?.files ?? [], loading: true, error: null },
      }));
      ipc.gitCommitFiles(cwd, sha).then(
        (files) => {
          if (myToken !== tokenRef.current) return;
          setEntries((prev) => ({ ...prev, [sha]: { files, loading: false, error: null } }));
        },
        (e: unknown) => {
          if (myToken !== tokenRef.current) return;
          fetchedRef.current.delete(sha);
          setEntries((prev) => ({
            ...prev,
            [sha]: { files: [], loading: false, error: gitErrorMessage(e) },
          }));
        },
      );
    },
    [cwd],
  );

  return { entries, ensure };
}

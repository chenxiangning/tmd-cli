/**
 * useCommitFiles —— 单提交文件清单按需拉取 + 组件级缓存(每 sha 一份)。
 *
 * Graph 展开与提交 diff tab 共用:ensure(sha) 幂等,fetchedRef 去重
 * (在途/已成的 sha 不再请求);失败移出去重集,下次展开自动重试;
 * cwd 切换整体作废(entries 与 cwd 同槽派生为空,旧 cwd 在途响应落盘即弃)。
 */

import { useCallback, useRef, useState } from "react";
import { ipc, type GitCommitFile } from "@kernel/ipc";
import { gitErrorMessage } from "../gitError";

interface CommitFilesEntry {
  files: GitCommitFile[];
  loading: boolean;
  error: string | null;
}

interface Cache {
  cwd: string | null;
  entries: Record<string, CommitFilesEntry>;
}

const EMPTY_ENTRIES: Record<string, CommitFilesEntry> = {};

export function useCommitFiles(cwd: string | null) {
  const [cache, setCache] = useState<Cache>({ cwd, entries: {} });
  /* 去重集与 cwd 同槽:cwd 变了旧 sha 集自然作废(懒换代,写 ref 只在 ensure 内)。 */
  const fetchedRef = useRef<{ cwd: string | null; set: Set<string> }>({ cwd, set: new Set() });
  const tokenRef = useRef(0);

  const ensure = useCallback(
    (sha: string) => {
      if (!cwd || sha.startsWith("scm-graph-")) return;
      if (fetchedRef.current.cwd !== cwd) fetchedRef.current = { cwd, set: new Set() };
      if (fetchedRef.current.set.has(sha)) return;
      fetchedRef.current.set.add(sha);
      const myToken = ++tokenRef.current;
      /* 写入一律经 prev.cwd 闸:旧 cwd 迟到的响应直接弃,不污染新 cwd 缓存 */
      const put = (entry: (prev: Record<string, CommitFilesEntry>) => CommitFilesEntry) =>
        setCache((prev) =>
          prev.cwd === cwd
            ? { cwd, entries: { ...prev.entries, [sha]: entry(prev.entries) } }
            : prev,
        );
      put((prev) => ({ files: prev[sha]?.files ?? [], loading: true, error: null }));
      ipc.gitCommitFiles(cwd, sha).then(
        (files) => {
          if (myToken !== tokenRef.current) return;
          put(() => ({ files, loading: false, error: null }));
        },
        (e: unknown) => {
          if (myToken !== tokenRef.current) return;
          if (fetchedRef.current.cwd === cwd) fetchedRef.current.set.delete(sha);
          put(() => ({ files: [], loading: false, error: gitErrorMessage(e) }));
        },
      );
    },
    [cwd],
  );

  return { entries: cache.cwd === cwd ? cache.entries : EMPTY_ENTRIES, ensure };
}

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

  const ensure = useCallback(
    (sha: string) => {
      if (!cwd || sha.startsWith("scm-graph-")) return;
      if (fetchedRef.current.cwd !== cwd) {
        fetchedRef.current = { cwd, set: new Set() };
        /* 领养新 cwd:put 闸只丢旧 cwd 的迟到响应,自身不换代 —— 不领养则
         * 切仓后 cache.cwd 恒旧值,entries 恒空,展开无声失效(2026-09-15 评审)。 */
        setCache((prev) => (prev.cwd === cwd ? prev : { cwd, entries: {} }));
      }
      if (fetchedRef.current.set.has(sha)) return;
      fetchedRef.current.set.add(sha);
      /* 按 sha 落槽,后写胜出;不允许用全局 token 丢响应——连开两个提交时
       * 先发的响应被丢 = 该 sha 永远 loading(去重集还不放行)= 历史点不开
       * (2026-09-15 实证)。旧 cwd 的迟到响应由 put 的 prev.cwd 闸丢弃。 */
      const put = (entry: (prev: Record<string, CommitFilesEntry>) => CommitFilesEntry) =>
        setCache((prev) =>
          prev.cwd === cwd
            ? { cwd, entries: { ...prev.entries, [sha]: entry(prev.entries) } }
            : prev,
        );
      put((prev) => ({ files: prev[sha]?.files ?? [], loading: true, error: null }));
      ipc.gitCommitFiles(cwd, sha).then(
        (files) => put(() => ({ files, loading: false, error: null })),
        (e: unknown) => {
          if (fetchedRef.current.cwd === cwd) fetchedRef.current.set.delete(sha);
          put(() => ({ files: [], loading: false, error: gitErrorMessage(e) }));
        },
      );
    },
    [cwd],
  );

  return { entries: cache.cwd === cwd ? cache.entries : EMPTY_ENTRIES, ensure };
}

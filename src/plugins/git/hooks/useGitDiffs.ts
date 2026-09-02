/**
 * useGitDiffs —— 单文件 patch 按需加载 + LRU(50 条/20MB) 缓存。
 *
 * key = cwd\0path\0staged。写操作/commit 后由调用方 invalidate() 清桶;
 * 传入 statusSignature 时,签名变化(幕布终端/外部编辑器动过仓库)自动
 * 作废缓存并重拉当前展开项 —— 抽屉与列表同源新鲜,不显示陈旧 diff。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type GitFilePatch } from "@kernel/ipc";
import { PatchLRU } from "./patchLru";

export interface GitPatchState {
  patch: GitFilePatch | null;
  loading: boolean;
  /** 选中路径变化后由 GitPanel 调;null = 收起抽屉 */
  select: (path: string | null, staged: boolean) => void;
  /** 写操作后清缓存(status 已 refresh 的前提下再调) */
  invalidate: () => void;
}

export function useGitDiffs(
  cwd: string | null,
  statusSignature?: string | null,
): GitPatchState {
  const [patch, setPatch] = useState<GitFilePatch | null>(null);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef(new PatchLRU());
  const tokenRef = useRef(0);
  const lastReqRef = useRef<{ path: string; staged: boolean } | null>(null);

  // cwd 切换:清桶 + 收起
  useEffect(() => {
    cacheRef.current.clear();
    setPatch(null);
    tokenRef.current += 1;
  }, [cwd]);

  /* 幕布外改动感知:5s 轮询的 status 签名(headSha + 文件集)变化 = 仓库被
     面板之外的途径改动。缓存全作废;当前展开项重拉,收起态则无需动作。 */
  const sigRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (statusSignature === undefined) return;
    const prev = sigRef.current;
    sigRef.current = statusSignature ?? null;
    if (prev === undefined || prev === (statusSignature ?? null)) return;
    cacheRef.current.clear();
    const last = lastReqRef.current;
    if (last) doSelectRef.current?.(last.path, last.staged);
  }, [statusSignature]);

  const doSelect = useCallback(
    (path: string | null, staged: boolean) => {
      // 所有分支(含 cache hit / null)入口先 bump —— 作废任何在途请求,
      // 防旧响应覆盖当前选中(race:慢响应在 cache-hit 切换后落地)
      const myToken = ++tokenRef.current;
      if (!cwd || !path) {
        setPatch(null);
        setLoading(false);
        return;
      }
      const key = `${cwd} ${path} ${staged ? "s" : "w"}`;
      const cached = cacheRef.current.get(key);
      if (cached) {
        setPatch(cached);
        setLoading(false);
        return;
      }
      setLoading(true);
      ipc.gitDiffFilePatch(cwd, path, staged).then(
        (p) => {
          if (myToken !== tokenRef.current) return;
          setLoading(false);
          if (p) {
            cacheRef.current.put(key, p);
            setPatch(p);
          } else {
            setPatch(null);
          }
        },
        () => {
          if (myToken !== tokenRef.current) return;
          setLoading(false);
          setPatch(null);
        },
      );
    },
    [cwd],
  );
  const doSelectRef = useRef(doSelect);
  doSelectRef.current = doSelect;

  const select = useCallback(
    (path: string | null, staged: boolean) => {
      lastReqRef.current = path ? { path, staged } : null;
      doSelect(path, staged);
    },
    [doSelect],
  );

  const invalidate = useCallback(() => {
    // bump token + 清当前展示:写操作后在途响应不得复活旧 diff 入缓存
    tokenRef.current += 1;
    cacheRef.current.clear();
    setPatch(null);
  }, []);

  return { patch, loading, select, invalidate };
}

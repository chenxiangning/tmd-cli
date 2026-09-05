/**
 * PushDialog 数据 hooks —— 自 PushDialog.tsx 拆出(文件规模铁则)。
 * usePushPreview:(remote, target) 180ms 防抖拉推送预览(token 竞态防护);
 * useCommitDetails:选中 sha → 变更文件清单(alive 防旧响应回写)。
 */

import { useEffect, useRef, useState } from "react";
import { ipc, type GitCommitFile, type GitPushPreview } from "@kernel/ipc";
import { gitErrorDisplay } from "../../gitError";

export const PREVIEW_LIMIT = 120;
const PREVIEW_DEBOUNCE_MS = 180;

export function usePushPreview(cwd: string, remote: string, target: string) {
  const [preview, setPreview] = useState<GitPushPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  /* 预览:目标变化 180ms 防抖;token 竞态防护。 */
  const previewToken = useRef(0);
  useEffect(() => {
    const t = target.trim();
    if (!t) {
      setPreview(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }
    const my = ++previewToken.current;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = window.setTimeout(() => {
      ipc.gitPushPreview(cwd, remote.trim() || "origin", t, PREVIEW_LIMIT).then(
        (data) => {
          if (my !== previewToken.current) return;
          setPreview(data);
          setPreviewLoading(false);
        },
        (e: unknown) => {
          if (my !== previewToken.current) return;
          setPreview(null);
          setPreviewLoading(false);
          setPreviewError(gitErrorDisplay(e));
        },
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [cwd, remote, target]);

  return { preview, previewLoading, previewError };
}

export function useCommitDetails(cwd: string, selectedSha: string | null) {
  const [details, setDetails] = useState<GitCommitFile[] | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  /* 选中提交 → 详情(变更文件清单)。 */
  useEffect(() => {
    if (!selectedSha) {
      setDetails(null);
      setDetailsError(null);
      return;
    }
    let alive = true;
    setDetailsLoading(true);
    setDetailsError(null);
    ipc.gitCommitFiles(cwd, selectedSha).then(
      (files) => {
        if (!alive) return;
        setDetails(files);
        setDetailsLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setDetails(null);
        setDetailsLoading(false);
        setDetailsError(gitErrorDisplay(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [cwd, selectedSha]);

  return { details, detailsLoading, detailsError };
}

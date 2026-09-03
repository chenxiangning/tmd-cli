/**
 * 提交 diff tab 契约 —— 历史视图 Graph 与中央编辑器区 tab 共同依赖。
 *
 * tab id = `git-commit-diff:<sha>`(一提交一 tab,重复打开只换 focus 文件);
 * kind = "git-commit-diff";payload 携带提交头信息(sha/摘要/作者/时间),
 * tab 内文件切换不再回头改 payload。
 */

import { openTab } from "@kernel/tabs";

export const COMMIT_TAB_KIND = "git-commit-diff";

export interface CommitTabPayload {
  cwd: string;
  sha: string;
  shortSha: string;
  summary: string;
  authorName: string;
  /** unix 秒 */
  authorWhen: number;
  /** 打开后默认选中的文件(点列表文件进入时的深链) */
  focusPath?: string;
}

/** 打开(或聚焦)提交 diff tab;refresh:重复打开把 focusPath 刷成最新。 */
export function openCommitDiffTab(tab: CommitTabPayload): void {
  openTab(
    {
      id: `${COMMIT_TAB_KIND}:${tab.sha}`,
      kind: COMMIT_TAB_KIND,
      title: `${tab.shortSha} ${tab.summary || "(空消息)"}`,
      // AppShell tab 标签渲染 baseName(path) → 取 `<cwd>/<短sha>` 当标签文案
      path: `${tab.cwd}/${tab.shortSha}`,
      payload: { ...tab },
    },
    { refresh: true },
  );
}

export function readCommitTabPayload(tab: {
  kind: string;
  payload: unknown;
}): CommitTabPayload | null {
  if (tab.kind !== COMMIT_TAB_KIND) return null;
  const p = tab.payload as Partial<CommitTabPayload> | null;
  if (!p?.cwd || !p?.sha) return null;
  return {
    cwd: p.cwd,
    sha: p.sha,
    shortSha: p.shortSha ?? p.sha.slice(0, 7),
    summary: p.summary ?? "",
    authorName: p.authorName ?? "",
    authorWhen: p.authorWhen ?? 0,
    focusPath: p.focusPath,
  };
}

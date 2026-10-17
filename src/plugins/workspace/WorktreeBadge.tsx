/**
 * 会话行 worktree 徽标:tmd.wtSessions.v1 有该会话记录时显示分支名
 * (title = wtPath)。useSyncExternalStore 订阅模块级版本号,弹层写入即刷新。
 */

import { useSyncExternalStore } from "react";
import { subscribeWtSessions, wtSessionOf, wtSessionsVersion } from "./worktreeSession";

export function WorktreeBadge({ sessionId }: { sessionId: string | undefined }) {
  /* 版本号作快照(map 每读重建,不能作 snapshot),版本变再读 map。 */
  useSyncExternalStore(subscribeWtSessions, wtSessionsVersion);
  const ref = wtSessionOf(sessionId);
  if (!ref) return null;
  return (
    <span className="thread-wt-badge" title={ref.wtPath}>
      {ref.branch}
    </span>
  );
}

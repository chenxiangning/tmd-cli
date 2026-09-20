/**
 * 「查看文件」浏览器整体切换段 —— kernel workspaceFileBrowser 开合态的消费端:
 * openId 在位且实现/目标工作区都在位时返回浏览器视图(整体替换任务列表),
 * 否则返回 null(常态)。目标工作区被移除时自动关闭。
 * 自 index.tsx 拆出(文件规模铁则)。
 */

import { useEffect, type ReactNode, type RefObject } from "react";
import { useWorkspaces } from "@kernel/workspace";
import {
  closeWorkspaceFiles,
  useWorkspaceFileBrowserOpenId,
  useWorkspaceFileBrowserView,
} from "@kernel/workspaceFileBrowser";

/** 返回浏览器视图节点;null = 常态任务列表(调用方按 ?? 渲染原内容)。 */
export function useWorkspaceBrowserSwap(
  sidebarRef: RefObject<HTMLDivElement | null>,
): ReactNode {
  const { list } = useWorkspaces();
  const openId = useWorkspaceFileBrowserOpenId();
  const BrowserView = useWorkspaceFileBrowserView();
  useEffect(() => {
    if (openId && !list.some((w) => w.id === openId)) closeWorkspaceFiles();
  }, [openId, list]);
  const ws = openId ? (list.find((w) => w.id === openId) ?? null) : null;
  if (!ws || !BrowserView) return null;
  return (
    <div className="ws-sidebar" ref={sidebarRef}>
      <BrowserView key={ws.id} workspaceId={ws.id} root={ws.root} />
    </div>
  );
}

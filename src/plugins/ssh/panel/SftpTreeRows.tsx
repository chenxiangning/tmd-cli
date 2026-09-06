/**
 * SFTP 树行渲染 —— 自 SftpTree.tsx 拆出(文件规模铁则)。
 * 目录行(懒展开 + 旋转指示)与文件行(点击开编辑器 tab),递归渲染。
 */

import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderClosed,
  FolderOpen,
} from "lucide-react";
import type { SftpEntry } from "@kernel/ipc";
import type { TreeNode } from "./sftpTreeShared";

export function TreeRows({
  path,
  depth,
  nodeFor,
  onToggle,
  onOpen,
  onMenu,
}: {
  path: string;
  depth: number;
  nodeFor: (path: string, name: string, kind: "dir" | "file") => TreeNode;
  onToggle: (node: TreeNode) => Promise<void> | void;
  onOpen: (node: TreeNode) => void;
  onMenu: (x: number, y: number, node: TreeNode) => void;
}) {
  const node = nodeFor(path, path === "." ? "/" : path.split("/").pop() ?? path, "dir");
  const isOpen = node.expanded;
  return (
    <div>
      <div
        className="ssh-tree-row"
        style={{ paddingLeft: 4 + depth * 12 }}
        onContextMenu={(e) => {
          e.preventDefault();
          onMenu(e.clientX, e.clientY, node);
        }}
      >
        <button type="button" className="ssh-tree-toggle" onClick={() => void onToggle(node)}>
          {node.loading ? (
            <span className="ssh-tree-spin" aria-label="加载中" />
          ) : isOpen ? (
            <ChevronDown size={11} />
          ) : (
            <ChevronRight size={11} />
          )}
        </button>
        {isOpen ? <FolderOpen size={12} aria-hidden /> : <FolderClosed size={12} aria-hidden />}
        <button
          type="button"
          className="ssh-tree-label"
          onClick={() => void onToggle(node)}
          title={node.path}
        >
          {node.name}
        </button>
      </div>
      {isOpen && node.children
        ? node.children.map((child) =>
            child.kind === "dir" ? (
              <TreeRows
                key={child.path}
                path={child.path}
                depth={depth + 1}
                nodeFor={nodeFor}
                onToggle={onToggle}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            ) : (
              <FileRow
                key={child.path}
                entry={child}
                depth={depth + 1}
                nodeFor={nodeFor}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            ),
          )
        : null}
    </div>
  );
}

function FileRow({
  entry,
  depth,
  nodeFor,
  onOpen,
  onMenu,
}: {
  entry: SftpEntry;
  depth: number;
  nodeFor: (path: string, name: string, kind: "dir" | "file") => TreeNode;
  onOpen: (node: TreeNode) => void;
  onMenu: (x: number, y: number, node: TreeNode) => void;
}) {
  const node = nodeFor(entry.path, entry.name, "file");
  return (
    <div
      className="ssh-tree-row"
      style={{ paddingLeft: 4 + depth * 12 }}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY, node);
      }}
    >
      <span className="ssh-tree-toggle" aria-hidden />
      <FileText size={12} aria-hidden />
      <button
        type="button"
        className="ssh-tree-label"
        onClick={() => onOpen(node)}
        title={node.path}
      >
        {node.name}
      </button>
    </div>
  );
}

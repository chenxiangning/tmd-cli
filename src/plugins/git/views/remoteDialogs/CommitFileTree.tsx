/**
 * CommitFileTree —— 推送对话框「选中提交详情」的变更文件树(嵌套目录 + numstat)。
 * 默认全展开;目录行点击折叠;文件行点击回调(打开中央提交 diff tab)。
 * 与 diffTree.ts 的一级分组不同:这里按完整路径递归建树,匹配 codemoss 预览树形态。
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FolderTree, FileText } from "lucide-react";
import type { GitCommitFile } from "@kernel/ipc";
import { STATUS_COLOR } from "../statusColor";

interface TreeNode {
  /** 目录完整路径(根为 "");文件行不用此字段 */
  path: string;
  name: string;
  dirs: TreeNode[];
  files: GitCommitFile[];
}

function insert(root: TreeNode, file: GitCommitFile): void {
  const parts = file.path.split("/");
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const dirPath = parts.slice(0, i + 1).join("/");
    let next = node.dirs.find((d) => d.path === dirPath);
    if (!next) {
      next = { path: dirPath, name: parts[i], dirs: [], files: [] };
      node.dirs.push(next);
    }
    node = next;
  }
  node.files.push(file);
}

function buildTree(files: GitCommitFile[], rootName: string): TreeNode {
  const root: TreeNode = { path: "", name: rootName, dirs: [], files: [] };
  for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    insert(root, f);
  }
  const sortNode = (n: TreeNode) => {
    n.dirs.sort((a, b) => a.name.localeCompare(b.name));
    n.dirs.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

export function CommitFileTree({
  rootName,
  files,
  selectedPath,
  onSelect,
}: {
  rootName: string;
  files: GitCommitFile[];
  selectedPath: string | null;
  onSelect: (file: GitCommitFile) => void;
}) {
  const root = useMemo(() => buildTree(files, rootName), [files, rootName]);
  /* 折叠集合:默认全展开(对齐 codemoss),存被收起的目录路径。 */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    const isOpen = !collapsed.has(node.path);
    const rows: ReactNode[] = [
      <button
        key={`dir:${node.path || "<root>"}`}
        type="button"
        onClick={() => toggle(node.path)}
        style={{ paddingLeft: depth * 14 }}
        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-(--tmd-fg-faint)" aria-hidden />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-(--tmd-fg-faint)" aria-hidden />
        )}
        <FolderTree className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-muted)" aria-hidden />
        <span className="truncate font-mono">{node.name}</span>
      </button>,
    ];
    if (isOpen) {
      node.dirs.forEach((d) => rows.push(renderNode(d, depth + 1)));
      for (const f of node.files) {
        const active = f.path === selectedPath;
        rows.push(
          <button
            key={`file:${f.path}`}
            type="button"
            title={f.oldPath ? `${f.oldPath} -> ${f.path}` : f.path}
            onClick={() => onSelect(f)}
            style={{ paddingLeft: (depth + 1) * 14 }}
            className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs ${
              active ? "bg-(--tmd-accent-soft)" : "hover:bg-(--tmd-bg-hover)"
            }`}
          >
            <span className={`w-3 shrink-0 text-center font-mono font-semibold ${STATUS_COLOR[f.status] ?? ""}`}>
              {f.status}
            </span>
            <FileText className="h-3.5 w-3.5 shrink-0 text-(--tmd-fg-muted)" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-(--tmd-fg)">
              {f.path.split("/").pop()}
            </span>
            {f.binary ? (
              <span className="shrink-0 text-[10px] text-(--tmd-fg-faint)">binary</span>
            ) : (
              <span className="shrink-0 font-mono text-[11px] tabular-nums">
                <span className="text-(--tmd-diff-inserted)">+{f.additions}</span>
                <span className="mx-0.5 text-(--tmd-fg-faint)">/</span>
                <span className="text-(--tmd-diff-removed)">-{f.deletions}</span>
              </span>
            )}
          </button>,
        );
      }
    }
    return <div key={`node:${node.path || "<root>"}`}>{rows}</div>;
  };

  return <div className="min-h-0 overflow-auto">{renderNode(root, 0)}</div>;
}

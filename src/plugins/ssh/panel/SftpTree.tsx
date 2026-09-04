/**
 * SftpTree —— 远端文件树(懒展开,点击文件开编辑器 tab)。
 * 单一节点注册表(useRef Map<path, TreeNode>),展开即拉子级;
 * 右键弹操作菜单(下载/上传到目录/新建目录/重命名/删除)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  FolderClosed,
  FolderOpen,
  Upload,
} from "lucide-react";
import { ipc, pickDirectory, pickFile, type SftpEntry, type SftpTransferState } from "@kernel/ipc";
import { openTab } from "@kernel/tabs";
import { useSshTransfers } from "../state";

interface TreeNode {
  path: string;
  name: string;
  kind: "dir" | "file";
  expanded: boolean;
  children?: SftpEntry[];
  loading: boolean;
}

/** 远端编辑 tab 打开入口(tab.id = ssh://{sessionId}{path},kind = "ssh-file")。 */
function openRemoteFileTab(sessionId: string, entry: SftpEntry) {
  openTab(
    {
      id: `ssh://${sessionId}${entry.path}`,
      title: entry.name,
      path: entry.path,
      kind: "ssh-file",
      payload: { sessionId, path: entry.path, name: entry.name },
    },
    { refresh: true },
  );
}

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

export function SftpTree({ sessionId, connected }: { sessionId: string; connected: boolean }) {
  const nodes = useRef(new Map<string, TreeNode>());
  const [, bump] = useState(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const transfers = useSshTransfers(sessionId);
  const rerender = useCallback(() => bump((n) => n + 1), []);

  const nodeFor = useCallback(
    (path: string, name: string, kind: "dir" | "file"): TreeNode => {
      let node = nodes.current.get(path);
      if (!node) {
        node = { path, name, kind, expanded: false, loading: false };
        nodes.current.set(path, node);
      }
      node.name = name;
      node.kind = kind;
      return node;
    },
    [],
  );

  useEffect(() => {
    nodes.current = new Map();
    nodeFor(".", "/", "dir");
    rerender();
  }, [sessionId, nodeFor, rerender]);

  const toggle = useCallback(
    async (node: TreeNode) => {
      if (node.kind !== "dir") return;
      if (node.children) {
        node.expanded = !node.expanded;
        rerender();
        return;
      }
      node.loading = true;
      rerender();
      try {
        const entries = await ipc.sftpList(sessionId, node.path);
        node.children = entries;
        node.expanded = true;
      } catch (e) {
        node.children = [];
        window.alert(`读取远端目录失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        node.loading = false;
        rerender();
      }
    },
    [sessionId, rerender],
  );

  const reloadAll = useCallback(() => {
    nodes.current = new Map();
    nodeFor(".", "/", "dir");
    void toggle(nodes.current.get(".")!);
  }, [nodeFor, toggle]);

  useEffect(() => {
    if (!connected) return;
    void toggle(nodes.current.get(".")!);
  }, [connected, toggle]);

  const openFile = useCallback(
    (node: TreeNode) => {
      openRemoteFileTab(sessionId, {
        path: node.path,
        name: node.name,
        kind: "file",
        sizeBytes: 0,
        mtime: 0,
      });
    },
    [sessionId],
  );

  const active = transfers.filter((t) => t.status === "running" || t.status === "queued");

  return (
    <div className="ssh-section ssh-sftp">
      <div className="ssh-section-head">
        <FolderClosed size={12} aria-hidden />
        <span>远端文件</span>
        <button
          type="button"
          className="ssh-icon-btn"
          title="上传文件"
          disabled={!connected}
          onClick={() => void uploadPicked(sessionId, reloadAll)}
        >
          <Upload size={12} />
        </button>
        <button
          type="button"
          className="ssh-icon-btn"
          title="下载根目录"
          disabled={!connected}
          onClick={() => void downloadNode(sessionId, nodes.current.get(".")!, true)}
        >
          <Download size={12} />
        </button>
      </div>
      {!connected ? (
        <div className="ssh-section-empty">连接建立后可浏览与编辑远端文件</div>
      ) : (
        <div className="ssh-sftp-tree">
          <TreeRows
            path="."
            depth={0}
            nodeFor={nodeFor}
            onToggle={toggle}
            onOpen={openFile}
            onMenu={(x, y, node) => setMenu({ x, y, node })}
          />
        </div>
      )}
      {active.length > 0 ? (
        <div className="ssh-transfer-list">
          {active.map((t) => (
            <TransferRow key={t.id} transfer={t} sessionId={sessionId} />
          ))}
        </div>
      ) : null}
      {menu ? (
        <TreeMenu
          sessionId={sessionId}
          state={menu}
          onClose={() => setMenu(null)}
          onMutate={reloadAll}
        />
      ) : null}
    </div>
  );
}

function TreeRows({
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

function TreeMenu({
  sessionId,
  state,
  onClose,
  onMutate,
}: {
  sessionId: string;
  state: MenuState;
  onClose: () => void;
  onMutate: () => void;
}) {
  const { node } = state;
  const parent = node.kind === "dir" ? node.path : parentPath(node.path);
  const target = node.path;

  const run = async (action: string) => {
    onClose();
    try {
      if (action === "download") {
        await downloadNode(sessionId, node, node.kind === "dir");
      } else if (action === "upload") {
        await uploadPicked(sessionId, onMutate, node.kind === "dir" ? node.path : parent);
      } else if (action === "mkdir") {
        const name = window.prompt("新目录名");
        if (!name?.trim()) return;
        await ipc.sftpMkdir(sessionId, joinRemote(parent, name.trim()));
        onMutate();
      } else if (action === "rename") {
        const name = window.prompt("新名称", node.name);
        if (!name?.trim() || name.trim() === node.name) return;
        await ipc.sftpRename(sessionId, node.path, joinRemote(parent, name.trim()));
        onMutate();
      } else if (action === "delete") {
        if (!window.confirm(`删除远端 ${node.path}?`)) return;
        await ipc.sftpDelete(sessionId, target, true);
        onMutate();
      }
    } catch (e) {
      window.alert(`操作失败:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const items = [
    { id: "download", label: node.kind === "dir" ? "下载目录…" : "下载文件…" },
    { id: "upload", label: "上传到此目录…" },
    { id: "mkdir", label: "新建目录…" },
    { id: "rename", label: "重命名…" },
    { id: "delete", label: "删除", danger: true },
  ];
  return (
    <>
      <div className="ssh-menu-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="ssh-menu" style={{ left: state.x, top: state.y }}>
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.danger ? "is-danger" : undefined}
            onClick={() => void run(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}

function parentPath(path: string) {
  const index = path.lastIndexOf("/");
  if (index < 0) return ".";
  if (index === 0) return "/";
  return path.slice(0, index);
}

function joinRemote(parent: string, child: string) {
  if (parent === "." || parent === "") return child;
  if (parent === "/") return `/${child}`;
  return `${parent}/${child}`;
}

async function downloadNode(sessionId: string, node: TreeNode, recursive: boolean) {
  const target = await pickDirectory("下载到本地目录");
  if (!target) return;
  try {
    const local = node.kind === "dir" ? target : `${target}/${node.name}`;
    await ipc.sftpTransfer(sessionId, "download", node.path, local, recursive);
  } catch (e) {
    window.alert(`下载失败:${e instanceof Error ? e.message : String(e)}`);
  }
}

async function uploadPicked(sessionId: string, onMutate: () => void, remoteDir = ".") {
  const source = await pickFile("选择要上传的文件");
  if (!source) return;
  const name = source.split(/[\\/]/).pop() ?? "upload";
  try {
    await ipc.sftpTransfer(sessionId, "upload", source, joinRemote(remoteDir, name), false);
    onMutate();
  } catch (e) {
    window.alert(`上传失败:${e instanceof Error ? e.message : String(e)}`);
  }
}

function TransferRow({ transfer, sessionId }: { transfer: SftpTransferState; sessionId: string }) {
  const total = transfer.bytesTotal || 1;
  const pct = Math.min(100, Math.round((transfer.bytesDone / total) * 100));
  return (
    <div className="ssh-transfer-row">
      <span className="ssh-transfer-label">
        {transfer.direction === "upload" ? "↑" : "↓"} {basenameOf(transfer.sourcePath)}
      </span>
      <div className="ssh-transfer-bar">
        <div className="ssh-transfer-fill" style={{ width: `${pct}%` }} />
      </div>
      <button
        type="button"
        className="ssh-icon-btn"
        title="取消"
        onClick={() => void ipc.sftpTransferCancel(sessionId, transfer.id)}
      >
        ×
      </button>
    </div>
  );
}

function basenameOf(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

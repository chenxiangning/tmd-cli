/**
 * SFTP 树右键菜单 —— 自 SftpTree.tsx 拆出(文件规模铁则)。
 * 下载 / 上传到此目录 / 新建目录 / 重命名 / 删除(目录递归);
 * prompt/confirm 走原生对话框,失败 window.alert。
 */

import { ipc } from "@kernel/ipc";
import {
  downloadNode,
  joinRemote,
  parentPath,
  uploadPicked,
  type MenuState,
} from "./sftpTreeShared";

export function TreeMenu({
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

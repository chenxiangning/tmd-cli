/**
 * SFTP 树右键菜单 —— 自 SftpTree.tsx 拆出(文件规模铁则)。
 * 下载 / 上传到此目录即时执行;新建目录 / 重命名 / 删除经 onAction 交父层弹
 * InputDialog / ConfirmDialog(原生 prompt/confirm 清零轮,2026-10-02);
 * 失败经 onError 回流树体内联红字。
 */

import { t } from "@kernel/i18n";
import {
  downloadNode,
  parentPath,
  uploadPicked,
  type MenuState,
} from "./sftpTreeShared";
import type { TreeDialogAction } from "./SftpTreeDialogs";

type MenuAction = "download" | "upload" | TreeDialogAction;

export function TreeMenu({
  sessionId,
  state,
  onClose,
  onMutate,
  onAction,
  onError,
}: {
  sessionId: string;
  state: MenuState;
  onClose: () => void;
  onMutate: () => void;
  onAction: (kind: TreeDialogAction) => void;
  onError: (message: string) => void;
}) {
  const { node } = state;
  const parent = node.kind === "dir" ? node.path : parentPath(node.path);

  const run = async (action: MenuAction) => {
    onClose();
    if (action === "download") {
      const err = await downloadNode(sessionId, node, node.kind === "dir");
      if (err) onError(err);
    } else if (action === "upload") {
      const err = await uploadPicked(sessionId, onMutate, node.kind === "dir" ? node.path : parent);
      if (err) onError(err);
    } else {
      onAction(action);
    }
  };

  const items: Array<{ id: MenuAction; label: string; danger?: boolean }> = [
    { id: "download", label: node.kind === "dir" ? t("下载目录…") : t("下载文件…") },
    { id: "upload", label: t("上传到此目录…") },
    { id: "mkdir", label: t("新建目录…") },
    { id: "rename", label: t("重命名…") },
    { id: "delete", label: t("删除"), danger: true },
  ];
  return (
    <>
      <div className="ssh-menu-backdrop" role="presentation" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
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

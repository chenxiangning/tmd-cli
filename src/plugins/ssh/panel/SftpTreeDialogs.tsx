/**
 * SftpTree 操作对话框 —— 自 SftpTreeMenu.tsx 接续(原生弹窗清零轮,2026-10-02)。
 * 新建目录/重命名走 InputDialog(初值填当前名,空值禁交),删除走 ConfirmDialog
 * (danger 红底);递交后弹层即关,异步收尾的失败经 onError 回流树体内联红字。
 */

import { Trash } from "@phosphor-icons/react";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { ConfirmDialog, InputDialog } from "@kernel/DialogConfirm";
import { joinRemote, parentPath, type TreeNode } from "./sftpTreeShared";

export type TreeDialogAction = "mkdir" | "rename" | "delete";

export interface TreeDialogState {
  kind: TreeDialogAction;
  node: TreeNode;
}

export function TreeDialog({
  sessionId,
  state,
  onMutate,
  onClose,
  onError,
}: {
  sessionId: string;
  state: TreeDialogState;
  onMutate: () => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { node } = state;
  const parent = node.kind === "dir" ? node.path : parentPath(node.path);

  /* 弹层自关(onConfirm/onSubmit 后即 onClose),异步动作照常落地,失败回流。 */
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onMutate();
    } catch (e) {
      onError(t("操作失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
    }
  };

  if (state.kind === "delete") {
    return (
      <ConfirmDialog
        title={t("删除")}
        message={t("删除远端 {path}?", { path: node.path })}
        confirmLabel={t("删除")}
        danger
        icon={<Trash size="0.875rem" aria-hidden />}
        onConfirm={() => void run(() => ipc.sftpDelete(sessionId, node.path, true))}
        onClose={onClose}
      />
    );
  }

  if (state.kind === "mkdir") {
    return (
      <InputDialog
        title={t("新建目录")}
        label={t("新目录名")}
        onSubmit={(name) => void run(() => ipc.sftpMkdir(sessionId, joinRemote(parent, name)))}
        onClose={onClose}
      />
    );
  }

  return (
    <InputDialog
      title={t("重命名")}
      label={t("新名称")}
      initial={node.name}
      onSubmit={(name) => {
        if (name === node.name) return;
        void run(() => ipc.sftpRename(sessionId, node.path, joinRemote(parent, name)));
      }}
      onClose={onClose}
    />
  );
}

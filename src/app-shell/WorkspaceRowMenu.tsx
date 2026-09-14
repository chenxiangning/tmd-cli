/**
 * 工作区右键菜单 —— 下拉器(subbar 工作区按钮)与下拉行共用;合并 codemoss
 * 文件菜单与 Git 菜单的项集,视觉走 wsmenu 范式(portal + fixed + backdrop +
 * Escape,复用 SessionContextMenu 的类与纪律):
 *
 *   新建文件 / 新建文件夹 ─ 经文件面板槽落工作区根(非激活先切换,等树重挂再触发)
 *   重命名 ─ 工作区显示别名(kernel 无磁盘改名;window.prompt,SftpTreeMenu 同款)
 *   复制路径 / 在访达中显示 ─ 直连 navigator.clipboard / ipc
 *   移到废纸篓 ─ 两步武装确认(FileTreeContextMenu 同款),成功后移出工作区列表
 *   GIT 段 ─ 提交目录 / 添加·暂存全部 / 更新 / 推送 / 提取(直连 ipc git 命令)
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowsDownUp,
  Copy,
  DownloadSimple,
  FilePlus,
  FolderOpen,
  FolderSimplePlus,
  GitCommit,
  Pencil,
  Stack,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";
import { setFilePanelMode } from "@kernel/filePanel";
import { ipc } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { removeWorkspace, setActiveWorkspace, setWorkspaceAlias, workspaceDisplayName, type Workspace } from "@kernel/workspace";

/** 菜单定位:以点击点为左上,按估算尺寸视口内夹取(同 wsmenu 模式)。 */
function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), window.innerWidth - 220 - 12),
    y: Math.min(y, window.innerHeight - 420 - 12),
  };
}

function RowMenuItem({
  icon,
  label,
  busy,
  danger,
  armed,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  busy?: boolean;
  danger?: boolean;
  armed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`wsmenu-item${danger ? " is-danger" : ""}${armed ? " is-armed" : ""}`}
      disabled={busy}
      onClick={onClick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );
}

export function WorkspaceRowMenu({
  ws,
  position,
  onNewInTree,
  onClose,
}: {
  ws: Workspace;
  position: { x: number; y: number };
  /** 新建文件/文件夹:父层负责确保 files 面板 + 工作区激活后触发树句柄槽。 */
  onNewInTree: (kind: "file" | "folder") => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  /* 废纸篓武装态:首击仅进入确认,再击执行(codemoss trash 同款两步)。 */
  const [armed, setArmed] = useState(false);
  const pos = clampMenuPosition(position.x, position.y);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 统一执行链:成功关菜单;失败留菜单 + alert(先例:SftpTreeMenu)。 */
  const run = (action: () => Promise<unknown> | void) => {
    if (busy) return;
    setBusy(true);
    Promise.resolve()
      .then(action)
      .then(onClose)
      .catch((e: unknown) => {
        setBusy(false);
        window.alert(t("操作失败:{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      });
  };

  const stageAll = async () => {
    const st = await ipc.gitStatus(ws.root);
    const paths = st.files.filter((f) => f.status !== "C").map((f) => f.path);
    if (paths.length > 0) await ipc.gitStage(ws.root, paths);
  };

  const rename = () => {
    const name = window.prompt(t("设置别名"), workspaceDisplayName(ws));
    if (name === null) return;
    setWorkspaceAlias(ws.id, name);
    onClose();
  };

  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        role="presentation"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu session-menu" style={{ left: pos.x, top: pos.y }} role="menu">
        <RowMenuItem
          icon={<FilePlus size="0.8125rem" />}
          label={t("新建文件")}
          busy={busy}
          onClick={() => {
            onClose();
            onNewInTree("file");
          }}
        />
        <RowMenuItem
          icon={<FolderSimplePlus size="0.8125rem" />}
          label={t("新建文件夹")}
          busy={busy}
          onClick={() => {
            onClose();
            onNewInTree("folder");
          }}
        />
        <div className="wsmenu-divider" />
        <RowMenuItem icon={<Pencil size="0.8125rem" />} label={t("重命名")} busy={busy} onClick={rename} />
        <RowMenuItem
          icon={<Copy size="0.8125rem" />}
          label={t("复制路径")}
          busy={busy}
          onClick={() => void run(() => navigator.clipboard.writeText(ws.root))}
        />
        <div className="wsmenu-divider" />
        <RowMenuItem
          icon={<FolderOpen size="0.8125rem" />}
          label={t("在访达中显示")}
          busy={busy}
          onClick={() => void run(() => ipc.fsRevealInFileManager(ws.root))}
        />
        <RowMenuItem
          icon={<Trash size="0.8125rem" />}
          label={armed ? t("确认移到废纸篓?") : t("移到废纸篓")}
          danger
          armed={armed}
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            void run(async () => {
              await ipc.fsTrashEntry(ws.root);
              removeWorkspace(ws.id);
            });
          }}
        />
        <div className="wsmenu-divider" />
        <div className="panel-ws-menu-group">Git</div>
        <RowMenuItem
          icon={<GitCommit size="0.8125rem" />}
          label={t("提交目录...")}
          busy={busy}
          onClick={() => {
            setActiveWorkspace(ws.id);
            setFilePanelMode("git");
            onClose();
          }}
        />
        <RowMenuItem
          icon={<Stack size="0.8125rem" />}
          label={t("添加 / 暂存全部")}
          busy={busy}
          onClick={() => void run(stageAll)}
        />
        <RowMenuItem
          icon={<DownloadSimple size="0.8125rem" />}
          label={t("更新")}
          busy={busy}
          onClick={() => void run(() => ipc.gitPullPush(ws.root, "pull"))}
        />
        <RowMenuItem
          icon={<UploadSimple size="0.8125rem" />}
          label={t("推送...")}
          busy={busy}
          onClick={() => void run(() => ipc.gitPullPush(ws.root, "push"))}
        />
        <RowMenuItem
          icon={<ArrowsDownUp size="0.8125rem" />}
          label={t("提取...")}
          busy={busy}
          onClick={() => void run(() => ipc.gitPullPush(ws.root, "fetch"))}
        />
      </div>
    </>,
    document.body,
  );
}

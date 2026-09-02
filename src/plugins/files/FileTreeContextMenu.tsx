/**
 * 文件树右键菜单 —— 复刻 codemoss fileTreeContextMenu 的项集,视觉走 wsmenu
 * 范式(portal + fixed + backdrop + Escape,复用 SessionContextMenu 的类与纪律):
 *
 *   新建文件 / 新建文件夹 ─ 任意位置(行=该目录内,空白区=根)
 *   重命名 / 复制路径 ─ 仅行目标
 *   在访达中显示 ─ 仅行目标
 *   移到废纸篓 ─ 仅行目标,两步确认(首击武装,再击执行)
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Copy,
  FilePlus2,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
} from "lucide-react";
import type { DirEntry } from "@kernel/ipc";
import type { TreeMenuState } from "./useTreeOperations";

/** 菜单定位:以点击点为左上,按估算尺寸视口内夹取(同 wsmenu 模式)。 */
function clampMenuPosition(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), window.innerWidth - 220 - 12),
    y: Math.min(y, window.innerHeight - 320 - 12),
  };
}

export interface TreeMenuActions {
  createFile: (dir: string) => void;
  createFolder: (dir: string) => void;
  rename: (entry: DirEntry) => void;
  copyPath: (entry: DirEntry) => void;
  reveal: (entry: DirEntry) => void;
  trash: (entry: DirEntry) => void;
}

export function FileTreeContextMenu({
  state,
  root,
  actions,
  onClose,
}: {
  state: TreeMenuState;
  /** 文件树根目录:空白区右键时新建落在根。 */
  root: string;
  actions: TreeMenuActions;
  onClose: () => void;
}) {
  /** 废纸篓武装态:首击仅进入确认,再击执行(codemoss trash 同款两步)。 */
  const [armed, setArmed] = useState(false);
  const entry = state.entry;
  const pos = clampMenuPosition(state.x, state.y);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* 新建落点:目录行=目录内;文件行=其父目录;空白区=树根。 */
  const newDir = entry ? (entry.isDir ? entry.path : parentOf(entry.path, root)) : root;

  const item = (
    label: string,
    icon: ReactNode,
    onPick: () => void,
    extra?: { danger?: boolean; armed?: boolean },
  ) => (
    <button
      type="button"
      className={`wsmenu-item${extra?.danger ? " is-danger" : ""}${extra?.armed ? " is-armed" : ""}`}
      onClick={onPick}
    >
      <span className="wsmenu-item-icon">{icon}</span>
      <span className="wsmenu-item-label">{label}</span>
    </button>
  );

  return createPortal(
    <>
      <div
        className="wsmenu-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="wsmenu session-menu" style={{ left: pos.x, top: pos.y }} role="menu">
        {item("新建文件", <FilePlus2 size={13} />, () => {
          onClose();
          actions.createFile(newDir);
        })}
        {item("新建文件夹", <FolderPlus size={13} />, () => {
          onClose();
          actions.createFolder(newDir);
        })}
        {entry ? (
          <>
            <div className="wsmenu-divider" />
            {item("重命名", <Pencil size={13} />, () => {
              onClose();
              actions.rename(entry);
            })}
            {item("复制路径", <Copy size={13} />, () => {
              onClose();
              actions.copyPath(entry);
            })}
            <div className="wsmenu-divider" />
            {item("在访达中显示", <FolderOpen size={13} />, () => {
              onClose();
              actions.reveal(entry);
            })}
            <div className="wsmenu-divider" />
            {item(armed ? "确认移到废纸篓?" : "移到废纸篓", <Trash2 size={13} />, () => {
              if (!armed) {
                setArmed(true);
                return;
              }
              onClose();
              actions.trash(entry);
            }, { danger: true, armed })}
          </>
        ) : null}
      </div>
    </>,
    document.body,
  );
}

/** 文件行的父目录:取自路径末段之前;退化为根(顶层文件)。 */
function parentOf(path: string, root: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : root;
}

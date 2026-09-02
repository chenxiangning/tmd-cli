/**
 * 文件树操作钩子 —— 右键菜单/工具栏的全部动作实现 + 菜单与命名弹窗状态。
 * 照抄 codemoss useFileTreeItemOperations 的语义,乐观更新降级为「刷新所在目录」:
 * 树是懒加载快照,操作完成后重拉受影响目录并展开,零延迟感来自目录级刷新足够快。
 *
 * 级联纪律(codemoss 同款):
 * - 删除/重命名目录 → 级联关闭其下所有文件 tab,作废对应草稿与内容缓存;
 * - 重命名文件 → 迁移草稿,tab 若开着则关旧开新(内容按新路径重载)。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ipc, type DirEntry } from "@kernel/ipc";
import { closeTab, getTabs } from "@kernel/tabs";
import {
  cacheDeletePrefix,
  draftDeletePrefix,
  draftRenamePrefix,
  pathEqualsOrUnder,
} from "./editor/fileCache";
import { openFileInTab } from "./openFile";

/** 命名弹窗:new-file/new-folder 在 dir 下新建;rename 改名 entry。 */
export type TreePrompt =
  | { kind: "new-file"; dir: string }
  | { kind: "new-folder"; dir: string }
  | { kind: "rename"; entry: DirEntry };

/** 右键菜单状态:entry = 目标行;null = 树空白区(只放新建两项)。 */
export interface TreeMenuState {
  x: number;
  y: number;
  entry: DirEntry | null;
}

/** 父目录(两种分隔符通吃);无分隔符时返回 null(不该发生在树内路径)。 */
function dirname(path: string): string | null {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx > 0 ? path.slice(0, idx) : null;
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${name}`;
}

/** 复制文本:优先 async clipboard,非安全上下文回退 execCommand(codemoss 同思路)。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

export function useTreeOperations(opts: {
  root: string;
  /** 重拉某目录并展示(reveal 语义:root 重拉根层,其余展开+刷新该层)。 */
  revealDir: (dir: string) => Promise<void>;
  setSelected: (path: string | null) => void;
}) {
  const { root, revealDir, setSelected } = opts;
  const [menu, setMenu] = useState<TreeMenuState | null>(null);
  const [prompt, setPrompt] = useState<TreePrompt | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  /* 树内轻提示(无全局 toast 体系):复制成功/删除与访达失败等瞬时反馈。 */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback((x: number, y: number, entry: DirEntry | null) => {
    setMenu({ x, y, entry });
  }, []);

  const openPrompt = useCallback((next: TreePrompt) => {
    setPromptError(null);
    setPrompt(next);
  }, []);

  const closePrompt = useCallback(() => {
    setPrompt(null);
    setPromptError(null);
  }, []);

  /** 关闭某路径(或目录子孙)的全部文件 tab。子孙匹配双分隔符(Rust 在 Windows 返回 `\`)。 */
  const closeTabsUnder = useCallback((prefix: string) => {
    for (const t of getTabs()) {
      if (t.kind !== "file") continue;
      if (pathEqualsOrUnder(t.path, prefix)) closeTab(t.id);
    }
  }, []);

  const createFile = useCallback(
    async (dir: string, name: string) => {
      const path = joinPath(dir, name);
      try {
        /* 新建专用命令:同名已存在报错,绝不覆写(write_file 是保存通道,允许覆写) */
        await ipc.fsCreateFile(path);
      } catch (e) {
        setPromptError(String(e));
        return;
      }
      closePrompt();
      await revealDir(dir);
      setSelected(path);
      openFileInTab(path);
    },
    [revealDir, setSelected, closePrompt],
  );

  const createFolder = useCallback(
    async (dir: string, name: string) => {
      const path = joinPath(dir, name);
      try {
        await ipc.fsCreateDir(path);
      } catch (e) {
        setPromptError(String(e));
        return;
      }
      closePrompt();
      await revealDir(dir);
      setSelected(path);
    },
    [revealDir, setSelected, closePrompt],
  );

  const rename = useCallback(
    async (entry: DirEntry, name: string) => {
      /* 输入原名 = 无操作(后端会把同路径撞名报「已存在」,直接短路更符合直觉) */
      if (name === entry.name) {
        closePrompt();
        return;
      }
      let newPath: string;
      try {
        newPath = await ipc.fsRenameEntry(entry.path, name);
      } catch (e) {
        setPromptError(String(e));
        return;
      }
      closePrompt();
      draftRenamePrefix(entry.path, newPath);
      const hadTab = getTabs().some((t) => t.kind === "file" && t.path === entry.path);
      closeTabsUnder(entry.path);
      cacheDeletePrefix(entry.path);
      await revealDir(dirname(entry.path) ?? root);
      setSelected(newPath);
      if (!entry.isDir && hadTab) openFileInTab(newPath);
    },
    [revealDir, setSelected, closePrompt, closeTabsUnder, root],
  );

  const trash = useCallback(
    async (entry: DirEntry) => {
      try {
        await ipc.fsTrashEntry(entry.path);
      } catch (e) {
        /* 无弹窗在开,失败走树内轻提示 */
        showNotice(String(e));
        return;
      }
      closeTabsUnder(entry.path);
      draftDeletePrefix(entry.path);
      cacheDeletePrefix(entry.path);
      await revealDir(dirname(entry.path) ?? root);
      setSelected(dirname(entry.path));
    },
    [revealDir, setSelected, closeTabsUnder, root, showNotice],
  );

  const copyPath = useCallback(
    (entry: DirEntry) => {
      void copyText(entry.path).then(
        () => showNotice("已复制路径"),
        () => showNotice("复制失败"),
      );
    },
    [showNotice],
  );

  const revealInFileManager = useCallback(
    (entry: DirEntry) => {
      ipc.fsRevealInFileManager(entry.path).catch((e) => showNotice(String(e)));
    },
    [showNotice],
  );

  /** 提交命名弹窗(按 kind 分发);失败保持弹窗开启并展示 promptError。 */
  const submitPrompt = useCallback(
    (name: string) => {
      if (!prompt) return;
      if (prompt.kind === "new-file") void createFile(prompt.dir, name);
      else if (prompt.kind === "new-folder") void createFolder(prompt.dir, name);
      else void rename(prompt.entry, name);
    },
    [prompt, createFile, createFolder, rename],
  );

  return {
    menu,
    openMenu,
    closeMenu,
    prompt,
    promptError,
    openPrompt,
    closePrompt,
    submitPrompt,
    copyPath,
    revealInFileManager,
    trash,
    notice,
  };
}

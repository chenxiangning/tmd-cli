/**
 * 当前挂载 FileTree 的动作句柄注册表 —— 自 FileTree.tsx 拆出
 * (only-export-components):模块级单例槽,FileTree 挂载时上交,
 * 外壳 subbar 的 refresh/newFile/newFolder 按钮据此转发。
 */

import { useEffect } from "react";

interface TreeHandles {
  reload: () => Promise<void>;
  newFile: () => void;
  newFolder: () => void;
  /** 详情页「定位到文件」:逐层展开祖先目录后选中该路径;远程树不实现(菜单隐藏该项)。 */
  revealFile?: (path: string) => void;
}

let activeTreeHandles: TreeHandles | null = null;

/** 注册表槽读口:外壳按钮消费(未挂载 FileTree 时为 null,按钮无操作)。 */
export function getActiveTreeHandles(): TreeHandles | null {
  return activeTreeHandles;
}

/** FileTree 挂载时上交动作句柄;卸载即断开(置 null)。 */
export function setActiveTreeHandles(handles: TreeHandles | null): void {
  activeTreeHandles = handles;
}

/** 侧栏工作区文件浏览器(WorkspaceFileBrowser)的「定位到文件」槽:与右栏树独立挂载。 */
let sidebarRevealFile: ((path: string) => void) | null = null;

export function setSidebarRevealFile(fn: ((path: string) => void) | null): void {
  sidebarRevealFile = fn;
}

/** 「定位到文件」共享实现:自浅向深逐层 reveal 祖先目录(每层等快照),末了选中。 */
export function makeRevealFile(
  root: string,
  revealDir: (dir: string) => Promise<void>,
  setSelected: (path: string | null) => void,
): (path: string) => void {
  return (path) => {
    const base = root.replace(/[\\/]+$/, "");
    const norm = path.replace(/\\/g, "/");
    const rel = norm.startsWith(`${base}/`) ? norm.slice(base.length + 1) : norm;
    const parts = rel.split("/").filter(Boolean);
    const walk = (i: number): Promise<void> =>
      i < parts.length
        ? revealDir(`${base}/${parts.slice(0, i).join("/")}`).then(() => walk(i + 1))
        : Promise.resolve();
    void walk(1).then(() => setSelected(path));
  };
}

/** 已挂载树的 reveal 目标(右栏 + 侧栏):菜单一次点击两棵树同步定位。 */
export function collectRevealTargets(): Array<(path: string) => void> {
  const out: Array<(path: string) => void> = [];
  if (activeTreeHandles?.revealFile) out.push(activeTreeHandles.revealFile);
  if (sidebarRevealFile) out.push(sidebarRevealFile);
  return out;
}

/** 侧栏浏览器接线:挂载期上交 revealFile,卸载即断开。 */
export function useSidebarTreeReveal(
  root: string,
  revealDir: (dir: string) => Promise<void>,
  setSelected: (path: string | null) => void,
): void {
  useEffect(() => {
    const fn = makeRevealFile(root, revealDir, setSelected);
    setSidebarRevealFile(fn);
    return () => setSidebarRevealFile(null);
  }, [root, revealDir, setSelected]);
}

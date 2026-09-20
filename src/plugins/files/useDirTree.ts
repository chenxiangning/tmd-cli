/**
 * 目录树列表状态 —— 自 FileTree 抽出(侧栏工作区文件浏览器与右栏文件树
 * 共用同一实现):根层拉取、目录懒展开、选中态、刷新 = 根层 + 展开快照并发重拉。
 * 右键菜单/命名/删除等编辑操作留在右栏(useTreeOperations),本钩子只管浏览。
 */

import { useCallback, useEffect, useState } from "react";
import { ipc, type DirEntry } from "@kernel/ipc";
import { openFileInTab } from "@kernel/fileTabs";

export function useDirTree(root: string) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, DirEntry[]>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reloadRoot = useCallback(async () => {
    setLoading(true);
    try {
      const list = await ipc.fsListDir(root);
      setEntries(list);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [root]);

  /* 刷新按钮语义:根层与全部展开目录快照并发重拉;消失的目录从展开表摘除。 */
  const reloadAll = useCallback(async () => {
    setLoading(true);
    try {
      const dirs = Object.keys(expanded);
      const settled = await Promise.allSettled([
        ipc.fsListDir(root),
        ...dirs.map((dir) => ipc.fsListDir(dir)),
      ]);
      setEntries(settled[0].status === "fulfilled" ? settled[0].value : []);
      const next: Record<string, DirEntry[]> = {};
      dirs.forEach((dir, i) => {
        const r = settled[i + 1];
        /* 目录消失(被删/改名):不进新表 = 从展开表摘除 */
        if (r.status === "fulfilled") next[dir] = r.value;
      });
      setExpanded(next);
    } finally {
      setLoading(false);
    }
  }, [root, expanded]);

  /* 首拉:挂载即取根层(key={root} 使工作区切换 = 重挂载,天然覆盖两场景);
   * 刷新按钮才需要 reloadAll —— 展开目录快照 + 打开中 tab 的内容缓存。 */
  useEffect(() => {
    void reloadRoot();
  }, [reloadRoot]);

  /* 重拉某目录并展示(reveal 语义):root 走根层;其余展开 + 刷新该层快照。 */
  const revealDir = useCallback(
    async (dir: string) => {
      if (dir === root) {
        await reloadRoot();
        return;
      }
      try {
        const children = await ipc.fsListDir(dir);
        setExpanded((prev) => ({ ...prev, [dir]: children }));
      } catch {
        /* 目录消失(被删/改名):从展开表摘除 */
        setExpanded(({ [dir]: _drop, ...rest }) => rest);
      }
    },
    [root, reloadRoot],
  );

  /* 行点击:文件 = 选中 + 开 tab;目录 = 选中 + 展开/折叠(懒拉子层)。 */
  const toggle = useCallback(
    (entry: DirEntry) => {
      if (!entry.isDir) {
        setSelectedPath(entry.path);
        openFileInTab(entry.path);
        return;
      }
      setSelectedPath(entry.path);
      if (expanded[entry.path]) {
        setExpanded(({ [entry.path]: _drop, ...rest }) => rest);
        return;
      }
      void ipc.fsListDir(entry.path).then((children) =>
        setExpanded((prev) => ({ ...prev, [entry.path]: children })),
      );
    },
    [expanded],
  );

  return {
    entries,
    expanded,
    selectedPath,
    setSelectedPath,
    loading,
    reloadRoot,
    reloadAll,
    revealDir,
    toggle,
  };
}

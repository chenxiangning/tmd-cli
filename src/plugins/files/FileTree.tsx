/**
 * 文件树主体 —— 自 index.tsx 拆出(文件规模铁则)。
 *
 * 文件树列表 + 右键菜单 + 命名弹窗。展开态就地保存;刷新 = 根层与全部
 * 展开目录快照并发重拉;动作句柄经 treeHandles.ts 注册表槽上交
 * (refresh / newFile / newFolder 由外壳 subbar 按钮消费)。
 * 列表渲染与覆盖层(提示/菜单/命名弹窗)拆为本文件内
 * FileTreeRows/FileTreeOverlays(no-high-complexity 降分支)。
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { ipc, type DirEntry } from "@kernel/ipc";
import { t } from "@kernel/i18n";
import { FileTreeOverlays } from "./FileTreeOverlays";
import { useWorkspaces } from "@kernel/workspace";
import { FileTreeRow } from "./FileTreeRow";
import { openFileInTab } from "./openFile";
import { useTreeOperations } from "./useTreeOperations";
import { useGitDecorations } from "./gitDecorate";
import { useRepoBranches } from "./useRepoBranches";
import { setActiveTreeHandles } from "./treeHandles";

/** 树列表:加载中/空态/递归行渲染(自 FileTree 拆出降分支)。 */
function FileTreeRows({
  entries,
  expanded,
  loading,
  selectedPath,
  gitColors,
  repoTags,
  toggle,
  rowMenu,
  copyPath,
  reveal,
}: {
  entries: DirEntry[];
  expanded: Record<string, DirEntry[]>;
  loading: boolean;
  selectedPath: string | null;
  gitColors: ReadonlyMap<string, string>;
  repoTags: ReadonlyMap<string, string>;
  toggle: (entry: DirEntry) => void;
  rowMenu: (entry: DirEntry) => (e: React.MouseEvent) => void;
  copyPath: (entry: DirEntry) => void;
  reveal: (entry: DirEntry) => void;
}) {
  const renderEntries = (list: DirEntry[], depth: number): React.ReactNode =>
    list.map((e) => {
      const isOpen = expanded[e.path] !== undefined;
      return (
        <div key={e.path}>
          <FileTreeRow
            entry={e}
            depth={depth}
            expanded={isOpen}
            selected={selectedPath === e.path}
            decoColor={gitColors.get(e.path)}
            repoTag={repoTags.get(e.path)}
            onClick={() => toggle(e)}
            onContextMenu={rowMenu(e)}
            onCopyPath={() => copyPath(e)}
            onReveal={() => reveal(e)}
          />
          {isOpen && renderEntries(expanded[e.path], depth + 1)}
        </div>
      );
    });

  if (loading && entries.length === 0) {
    return (
      <div className="file-tree-loading-row" role="status" aria-live="polite">
        <span className="file-tree-loading-spinner" aria-hidden>
          <ArrowClockwise size="0.75rem" />
        </span>
        <span>{t("加载中…")}</span>
      </div>
    );
  }
  if (entries.length === 0) {
    return <div className="file-tree-empty">{t("目录为空")}</div>;
  }
  return <>{renderEntries(entries, 0)}</>;
}

function FileTree({ root }: { root: string }) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, DirEntry[]>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const gitColors = useGitDecorations(root);
  const repoTags = useRepoBranches(root);

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

  const ops = useTreeOperations({ root, revealDir, setSelected: setSelectedPath });

  /* 上交动作句柄给注册表槽(刷新 / 新建文件 / 新建文件夹按钮),卸载即断开。 */
  useEffect(() => {
    setActiveTreeHandles({
      reload: reloadAll,
      newFile: () => ops.openPrompt({ kind: "new-file", dir: root }),
      newFolder: () => ops.openPrompt({ kind: "new-folder", dir: root }),
    });
    return () => setActiveTreeHandles(null);
  }, [reloadAll, root, ops.openPrompt]);

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

  const rowMenu = useCallback(
    (entry: DirEntry) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      ops.openMenu(e.clientX, e.clientY, entry);
    },
    [ops],
  );

  return (
    <div className="file-tree-panel">
      {/* 顶部 toolbar(root label + 文件操作按钮)由 RightPanelToolbar 统一提供;
          列表空白区右键 = 根目录新建。 */}
      <div
        className="file-tree-list"
        onContextMenu={(e) => {
          e.preventDefault();
          ops.openMenu(e.clientX, e.clientY, null);
        }}
      >
        <FileTreeRows
          entries={entries}
          expanded={expanded}
          loading={loading}
          selectedPath={selectedPath}
          gitColors={gitColors}
          repoTags={repoTags}
          toggle={toggle}
          rowMenu={rowMenu}
          copyPath={ops.copyPath}
          reveal={ops.revealInFileManager}
        />
      </div>

      <FileTreeOverlays
        root={root}
        notice={ops.notice}
        menu={ops.menu}
        prompt={ops.prompt}
        promptError={ops.promptError}
        openPrompt={ops.openPrompt}
        copyPath={ops.copyPath}
        revealInFileManager={ops.revealInFileManager}
        trash={ops.trash}
        closeMenu={ops.closeMenu}
        closePrompt={ops.closePrompt}
        submitPrompt={ops.submitPrompt}
      />
    </div>
  );
}

/** 右侧文件树 —— root 跟随当前激活工作区;切换工作区时 key 重挂载,重置展开态。 */
export function ActiveWorkspaceFileTree() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root;
  if (!root) return null;
  return <FileTree key={root} root={root} />;
}

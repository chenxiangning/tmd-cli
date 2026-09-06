/**
 * 文件树主体 —— 自 index.tsx 拆出(文件规模铁则)。
 *
 * 文件树列表 + 右键菜单 + 命名弹窗。展开态就地保存;刷新 = 根层与全部
 * 展开目录快照并发重拉;动作句柄经 getActiveTreeHandles() 上交注册表槽
 * (refresh / newFile / newFolder 由外壳 subbar 按钮消费)。
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { ipc, type DirEntry } from "@kernel/ipc";
import { useWorkspaces } from "@kernel/workspace";
import { FileTreeRow } from "./FileTreeRow";
import { openFileInTab } from "./openFile";
import { useTreeOperations } from "./useTreeOperations";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { NamePrompt } from "./NamePrompt";
import { useGitDecorations } from "./gitDecorate";

/** 当前挂载 FileTree 的动作句柄:注册表 refresh/newFile/newFolder 槽据此转发。 */
let activeTreeHandles: {
  reload: () => Promise<void>;
  newFile: () => void;
  newFolder: () => void;
} | null = null;

export function getActiveTreeHandles() {
  return activeTreeHandles;
}

function FileTree({ root }: { root: string }) {
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, DirEntry[]>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const gitColors = useGitDecorations(root);

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
    activeTreeHandles = {
      reload: reloadAll,
      newFile: () => ops.openPrompt({ kind: "new-file", dir: root }),
      newFolder: () => ops.openPrompt({ kind: "new-folder", dir: root }),
    };
    return () => {
      activeTreeHandles = null;
    };
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

  const renderEntries = (list: DirEntry[], depth: number) =>
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
            onClick={() => toggle(e)}
            onContextMenu={rowMenu(e)}
            onCopyPath={() => ops.copyPath(e)}
            onReveal={() => ops.revealInFileManager(e)}
          />
          {isOpen && renderEntries(expanded[e.path], depth + 1)}
        </div>
      );
    });

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
        {loading && entries.length === 0 ? (
          <div className="file-tree-loading-row" role="status" aria-live="polite">
            <span className="file-tree-loading-spinner" aria-hidden>
              <ArrowClockwise size={12} />
            </span>
            <span>加载中…</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="file-tree-empty">目录为空</div>
        ) : (
          renderEntries(entries, 0)
        )}
      </div>

      {ops.notice ? (
        <div className="file-tree-notice" role="status">
          {ops.notice}
        </div>
      ) : null}

      {ops.menu ? (
        <FileTreeContextMenu
          state={ops.menu}
          root={root}
          actions={{
            createFile: (dir) => ops.openPrompt({ kind: "new-file", dir }),
            createFolder: (dir) => ops.openPrompt({ kind: "new-folder", dir }),
            rename: (entry) => ops.openPrompt({ kind: "rename", entry }),
            copyPath: ops.copyPath,
            reveal: ops.revealInFileManager,
            trash: (entry) => void ops.trash(entry),
          }}
          onClose={ops.closeMenu}
        />
      ) : null}

      {ops.prompt ? (
        <NamePrompt
          title={
            ops.prompt.kind === "new-file"
              ? "新建文件"
              : ops.prompt.kind === "new-folder"
                ? "新建文件夹"
                : "重命名"
          }
          parentPath={
            ops.prompt.kind === "rename" ? ops.prompt.entry.path : ops.prompt.dir
          }
          initialName={ops.prompt.kind === "rename" ? ops.prompt.entry.name : undefined}
          confirmLabel={ops.prompt.kind === "rename" ? "重命名" : "创建"}
          error={ops.promptError}
          onCancel={ops.closePrompt}
          onConfirm={ops.submitPrompt}
        />
      ) : null}
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

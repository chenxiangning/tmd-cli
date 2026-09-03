/**
 * files 插件:右栏文件树(右键菜单 + 新建/重命名/删除)+ 中央 tab 文件编辑器。
 *
 * 视觉规范:
 * - 复刻 codemoss file-tree ─ 顶部 root label + 文件操作按钮(subbar 由外壳渲染)。
 * - 文件/文件夹行用 fileVisual 图标;行 hover 右侧按钮 = 在访达中显示 + 复制路径。
 * - 右键菜单走 wsmenu 范式(FileTreeContextMenu),命名走居中卡片(NamePrompt)。
 *
 * 注册点:
 * - fileVisual:可插拔文件图标/颜色(编辑器高亮走 CodeMirror)
 * - filePanel:{ refresh / newFile / newFolder } 槽,外壳 subbar 按钮消费
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Copy, FilePen, Folder, FolderOpen, RefreshCw } from "lucide-react";
import { ipc, type DirEntry } from "@kernel/ipc";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { clearDragPayload, setDragPayload } from "@kernel/internalDrag";
import { useWorkspaces } from "@kernel/workspace";
import { registerFileVisual, resolveFileVisual } from "@kernel/fileVisual";
import { registerFilePanel } from "@kernel/filePanel";
import { FileTabContent } from "./FileTabContent";
import { defaultFileVisualProvider } from "./fileVisual";
import { openFileInTab } from "./openFile";
import { useTreeOperations } from "./useTreeOperations";
import { FileTreeContextMenu } from "./FileTreeContextMenu";
import { NamePrompt } from "./NamePrompt";

/** 当前挂载 FileTree 的动作句柄:注册表 refresh/newFile/newFolder 槽据此转发。 */
let activeTreeHandles: {
  reloadRoot: () => Promise<void>;
  newFile: () => void;
  newFolder: () => void;
} | null = null;

/* ──────────────────────────────────────────────────────────
 * 文件/文件夹行 ─ 点击开 tab;右键呼菜单;hover 右侧 = 在访达中显示 + 复制路径。
 * ────────────────────────────────────────────────────────── */
function FileTreeRow({
  entry,
  depth,
  expanded,
  selected,
  onClick,
  onContextMenu,
  onCopyPath,
  onReveal,
}: {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCopyPath: () => void;
  onReveal: () => void;
}) {
  const hint = resolveFileVisual(entry.name, entry.isDir, expanded);
  const color = hint.colorClass ?? "text-(--tmd-fg)";

  /* 文件/文件夹拖到 composer:写 kernel 共享 payload,composer drop 时读 */
  function handleDragStart(e: React.DragEvent<HTMLButtonElement>) {
    e.dataTransfer.effectAllowed = "copy";
    /* 兜底:也写 text/plain,允许拖到外部应用 */
    e.dataTransfer.setData("text/plain", entry.path);
    setDragPayload({ path: entry.path, isDir: entry.isDir, name: entry.name });
  }
  function handleDragEnd() {
    /* 无论 drop 是否成功,结束都清 payload,防止跨拖拽残留 */
    clearDragPayload();
  }

  return (
    <div className={`file-tree-row-wrap${selected ? " is-selected" : ""}`}>
      <button
        type="button"
        className={`file-tree-row${selected ? " is-selected" : ""}`}
        style={{ paddingLeft: depth * 12 + 12 }}
        onClick={onClick}
        onContextMenu={onContextMenu}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        aria-expanded={entry.isDir ? expanded : undefined}
      >
        <span className={`file-tree-icon-cell${entry.isDir ? " has-chevron" : ""}`}>
          {entry.isDir ? (
            <>
              <span
                className={`file-tree-chevron${expanded ? " is-open" : ""}`}
                aria-hidden
              >
                <ChevronRight size={11} />
              </span>
              <span className="file-tree-icon" aria-hidden>
                <span
                  className="file-tree-icon-svg"
                  dangerouslySetInnerHTML={{ __html: hint.svgHtml }}
                />
              </span>
            </>
          ) : (
            <span className="file-tree-icon" aria-hidden>
              <span
                className="file-tree-icon-svg"
                dangerouslySetInnerHTML={{ __html: hint.svgHtml }}
              />
            </span>
          )}
        </span>
        <span className={`file-tree-name ${color}`}>
          {entry.name}
        </span>
      </button>
      <span className="file-tree-actions">
        {/* 在访达中显示 ─ 设计参考图 hover 组首位(开口文件夹 icon) */}
        <button
          type="button"
          className="file-tree-action"
          onClick={(ev) => {
            ev.stopPropagation();
            onReveal();
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onContextMenu(ev);
          }}
          aria-label="在访达中显示"
          title="在访达中显示"
        >
          <FolderOpen aria-hidden size={11} />
        </button>
        <button
          type="button"
          className="file-tree-action"
          onClick={(ev) => {
            ev.stopPropagation();
            onCopyPath();
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onContextMenu(ev);
          }}
          aria-label="复制路径"
          title="复制路径"
        >
          <Copy aria-hidden size={11} />
        </button>
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * 主体:文件树列表 + 右键菜单 + 命名弹窗。展开态就地保存。
 * ────────────────────────────────────────────────────────── */
function FileTree({ root }: { root: string }) {
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
      reloadRoot,
      newFile: () => ops.openPrompt({ kind: "new-file", dir: root }),
      newFolder: () => ops.openPrompt({ kind: "new-folder", dir: root }),
    };
    return () => {
      activeTreeHandles = null;
    };
  }, [reloadRoot, root, ops.openPrompt]);

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
              <RefreshCw size={12} />
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
function ActiveWorkspaceFileTree() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root;
  if (!root) return null;
  return <FileTree key={root} root={root} />;
}

export const filesPlugin: Plugin = {
  id: "files",
  meta: {
    name: "文件编辑",
    abbr: "FL",
    desc: "文件树、文件编辑、Markdown 预览",
    icon: FilePen,
    iconColor: "#4DAF7C",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    registerFileVisual(defaultFileVisualProvider);

    registerFilePanel({
      id: "files",
      label: "文件",
      icon: Folder,
      component: ActiveWorkspaceFileTree,
      refresh: () => void activeTreeHandles?.reloadRoot(),
      newFile: () => activeTreeHandles?.newFile(),
      newFolder: () => activeTreeHandles?.newFolder(),
    });
    ctx.contribute("editorCenter.tabContent", {
      order: 0,
      component: FileTabContent,
    });
  },
};

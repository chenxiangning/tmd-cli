/**
 * files 插件：右栏文件树(可插拔视觉 provider) + 中央 tab 文件预览(可插拔高亮器)。
 *
 * 视觉规范:
 * - 复刻 codemoss file-tree ─ 顶部 root label + 三个 ghost icon 按钮。
 * - 文件/文件夹行用 lucide-react 图标:folder/folder-open/file-text/file-code 等。
 * - 行 hover/selected 用 surface-hover,文件夹 hover 让位给 chevron。
 * - 行右侧 + 按钮:在新窗口打开(占位)。
 *
 * 注册点:
 * - fileVisual:文件类型→颜色/图标(默认 provider 可替换)
 * - fileHighlighter:文件内容→HTML(默认 highlight.js,可替换)
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, FilePlus2, Folder, RefreshCw } from "lucide-react";
import { ipc, type DirEntry } from "@kernel/ipc";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { openTab } from "@kernel/tabs";
import { clearDragPayload, setDragPayload } from "@kernel/internalDrag";
import { useWorkspaces } from "@kernel/workspace";
import { baseName } from "@kernel/pathUtils";
import { registerFileHighlighter } from "@kernel/fileHighlighter";
import { registerFileVisual, resolveFileVisual } from "@kernel/fileVisual";
import { registerFilePanel } from "@kernel/filePanel";
import { FileTabContent } from "./FileTabContent";
import { extToLang } from "./highlightLangs";
import { defaultFileVisualProvider } from "./fileVisual";
function openFileInTab(path: string) {
  openTab({
    id: `file:${path}`,
    kind: "file",
    title: baseName(path) || path,
    path,
    payload: { path },
  });
}

/* ──────────────────────────────────────────────────────────
 * 文件/文件夹 icon ─ 从 fileVisual.hint.icon 读取,无则用 lucide fallback。
 * ────────────────────────────────────────────────────────── */
function FileTreeRow({
  entry,
  depth,
  expanded,
  selected,
  onClick,
  onOpenInNewWindow,
}: {
  entry: DirEntry;
  depth: number;
  expanded: boolean;
  selected: boolean;
  onClick: () => void;
  onOpenInNewWindow: () => void;
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
        <button
          type="button"
          className="file-tree-action"
          onClick={(ev) => {
            ev.stopPropagation();
            onOpenInNewWindow();
          }}
          aria-label="在新窗口打开"
          title="在新窗口打开"
        >
          <FilePlus2 aria-hidden size={11} />
        </button>
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * 主体:文件树列表 + toolbar。展开态就地保存。
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

  const openInNewWindow = useCallback((entry: DirEntry) => {
    if (!entry.isDir) openFileInTab(entry.path);
    // eslint-disable-next-line no-console
    console.info("[files] open-in-new-window:", entry.path);

  }, []);

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
            onOpenInNewWindow={() => openInNewWindow(e)}
          />
          {isOpen && renderEntries(expanded[e.path], depth + 1)}
        </div>
      );
    });

  return (
    <div className="file-tree-panel">
      {/* 顶部 toolbar(root label + 文件操作按钮)由 RightPanelToolbar 统一提供。
        FileTree 只渲染列表。 */}
      <div className="file-tree-list">
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
  activate(ctx: PluginContext) {
    registerFileVisual(defaultFileVisualProvider);
    registerFileHighlighter({
      /* supports 只走纯函数 extToLang,不拉 hljs;
         highlight 首次调用时才动态 import hljs chunk(之后模块系统缓存,近零成本)。 */
      supports: (path) => extToLang(path) !== null,
      highlight: async (path, content) =>
        (await import("./highlighter")).highlightSync(path, content),
    });

    registerFilePanel({
      id: "files",
      label: "文件",
      icon: Folder,
      component: ActiveWorkspaceFileTree,
    });
    ctx.contribute("editorCenter.tabContent", {
      order: 0,
      component: FileTabContent,
    });
  },
};
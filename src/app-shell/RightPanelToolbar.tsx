/**
 * Right panel toolbar —— 复刻 codemoss right-panel-toolbar 视觉。
 *
 * 拆分后:
 * - TopBarPanelTabs: panel tab 按钮 + ⋯ more ─ 由 TopBar 渲染到顶部
 *   titlebar 右侧,与 search/quick-switcher 等其他 action 同一行。
 * - WorkspaceSubbar: workspace label + 文件操作按钮 ─ 由右侧 aside 顶部渲染。
 * - RightPanelToolbar: 内部组件,仅在右侧 aside 渲染 WorkspaceSubbar。
 */

import { memo, useEffect, useMemo, useState, type ForwardRefExoticComponent, type MouseEvent as ReactMouseEvent, type RefAttributes } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Ellipsis,
  ExternalLink,
  FilePlus2,
  Folder,
  FolderPlus,
  GitBranch,
  Globe2,
  LayoutDashboard,
  LayoutList,
  LucideProps,
  NotebookPen,
  PenLine,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  FILE_PANEL_TABS,
  setFilePanelMode,
  togglePinned,
  useFilePanel,
  type FilePanelTabId,
} from "@kernel/filePanel";
import { useWorkspaces } from "@kernel/workspace";
import { deriveWorkspaceName } from "@kernel/pathUtils";

type LucideIcon = ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>;

/** tab id → lucide icon ─ 复刻 codemoss PanelTabs.tabIcons。 */
const TAB_ICONS: Record<FilePanelTabId, LucideIcon> = {
  files: Folder,
  search: Search,
  git: GitBranch,
  projectMap: Globe2,
  intentCanvas: PenLine,
  radar: LayoutList,
  notes: NotebookPen,
  specHub: LayoutDashboard,
  detachedExplorer: ExternalLink,
};

/** 当前 toolbar 外显的 tab id 顺序 ─ 已钉住 + 当前激活的。 */
function resolveToolbarTabIds(
  active: "files" | "git",
  pinned: ReadonlySet<FilePanelTabId>,
): FilePanelTabId[] {
  const order: FilePanelTabId[] = [];
  for (const tab of FILE_PANEL_TABS) {
    if (pinned.has(tab.id) || active === tab.id) order.push(tab.id);
  }
  return order;
}

/** workspace 路径末段当 section title。例 /Users/x/CCGUI → CCGUI。 */
function deriveWorkspaceLabel(root: string, fallbackName?: string): string {
  return (fallbackName ?? (deriveWorkspaceName(root) || "WORKSPACE")).toUpperCase();
}

/* ──────────────────────────────────────────────────────────
 * TopBar 用 panel tabs 组件 ─ 由 header.right 挂点提供。
 * ────────────────────────────────────────────────────────── */
/** ⋯ 下拉只放这两项 ─ 其余 tab 未实装,等接入后再加回。 */
const OVERFLOW_TAB_IDS = ["files", "git"] as const;

export function TopBarPanelTabs() {
  const { mode, pinnedIds } = useFilePanel();
  const [overflowPos, setOverflowPos] = useState<{ x: number; y: number } | null>(null);

  const visibleTabIds = resolveToolbarTabIds(mode, pinnedIds);

  const handleSelect = (id: FilePanelTabId) => {
    if (id === "files" || id === "git") {
      setFilePanelMode(id);
      return;
    }
    if (id === "detachedExplorer") {
      // eslint-disable-next-line no-console
      console.info("[right-panel] open-detached-explorer (placeholder)");
      return;
    }
    togglePinned(id);
  };

  const toggleOverflow = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (overflowPos) {
      setOverflowPos(null);
      return;
    }
    // 以按钮右缘对齐菜单右缘,视口内夹取(同 wsmenu 模式)。
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 240;
    setOverflowPos({
      x: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      y: rect.bottom + 4,
    });
  };

  return (
    <div className="panel-tabs-row">
      <div className="panel-tabs" role="tablist" aria-label="右侧面板">
        {visibleTabIds.map((id) => {
          const Icon = TAB_ICONS[id];
          const isActive = id === mode;
          const meta = FILE_PANEL_TABS.find((t) => t.id === id);
          return (
            <button
              key={id}
              type="button"
              className={`panel-tab${isActive ? " is-active" : ""}${id === "git" ? " git" : ""}`}
              onClick={() => handleSelect(id)}
              aria-label={meta?.label}
              title={meta?.label}
            >
              <Icon aria-hidden />
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="panel-tab panel-tab-overflow"
        onClick={toggleOverflow}
        aria-label="更多面板"
        title="更多面板"
      >
        <Ellipsis aria-hidden />
      </button>

      {overflowPos ? (
        <PanelOverflowMenu
          mode={mode}
          pinnedIds={pinnedIds}
          position={overflowPos}
          onClose={() => setOverflowPos(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 更多面板下拉(⋯) —— portal 挂 document.body + fixed 定位(复刻 wsmenu 模式),
 * 跳出 titlebar 层叠上下文,杜绝被文件树压住/背景透明。
 * 行点击 = 激活该面板(未钉则顺带钉上);复选框点击 = 仅切换钉住状态,菜单不关。
 */
function PanelOverflowMenu({
  mode,
  pinnedIds,
  position,
  onClose,
}: {
  mode: "files" | "git";
  pinnedIds: ReadonlySet<FilePanelTabId>;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="panel-overflow-backdrop" onClick={onClose} />
      <div className="panel-overflow-menu" style={{ left: position.x, top: position.y }} role="menu">
        {OVERFLOW_TAB_IDS.map((id) => {
          const Icon = TAB_ICONS[id];
          const meta = FILE_PANEL_TABS.find((t) => t.id === id);
          const isActive = id === mode;
          const isChecked = pinnedIds.has(id);
          return (
            <div
              key={id}
              className={`panel-overflow-item${isActive ? " is-active" : ""}`}
              role="menuitem"
              onClick={() => {
                setFilePanelMode(id);
                if (!isChecked) togglePinned(id);
                onClose();
              }}
            >
              <span className="panel-overflow-item-icon" aria-hidden>
                <Icon aria-hidden />
              </span>
              <span className="panel-overflow-item-label">{meta?.label}</span>
              <span
                className={`panel-overflow-item-check${isChecked ? " is-checked" : ""}`}
                role="checkbox"
                aria-checked={isChecked}
                title="钉到工具条"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePinned(id);
                }}
              >
                {isChecked ? <Check aria-hidden /> : null}
              </span>
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

/* ──────────────────────────────────────────────────────────
 * 第 2 行:workspace label + 文件操作按钮。
 * ────────────────────────────────────────────────────────── */
export function WorkspaceSubbar() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root;
  const label = useMemo(() => (root ? deriveWorkspaceLabel(root) : ""), [root]);

  if (!root) return null;

  return (
    <div className="panel-subbar">
      <span className="panel-subbar-label" title={root}>{label}</span>
      <span className="panel-subbar-actions">
        <button
          type="button"
          className="panel-subbar-action"
          aria-label="打开独立文件窗口"
          title="打开独立文件窗口"
          onClick={() => {
            // eslint-disable-next-line no-console
            console.info("[right-panel] open-detached-explorer (subbar)", root);
          }}
        >
          <ExternalLink size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label="新建文件"
          title="新建文件"
          onClick={() => {
            // eslint-disable-next-line no-console
            console.info("[right-panel] new-file under", root);
          }}
        >
          <FilePlus2 size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label="新建文件夹"
          title="新建文件夹"
          onClick={() => {
            // eslint-disable-next-line no-console
            console.info("[right-panel] new-folder under", root);
          }}
        >
          <FolderPlus size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label="刷新文件树"
          title="刷新文件树"
          onClick={() => {
            // eslint-disable-next-line no-console
            console.info("[right-panel] refresh-files under", root);
          }}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * 兼容旧调用 ─ 内部用,渲染 WorkspaceSubbar(panel tabs 已挪到 TopBarPanelTabs)。
 * ────────────────────────────────────────────────────────── */
/* memo 兜底:无 props,父级(AppShell 右栏 aside)重渲染时不再连带重渲染。 */
export const RightPanelToolbar = memo(function RightPanelToolbar() {
  return (
    <div className="right-panel-toolbar">
      <WorkspaceSubbar />
    </div>
  );
});

/**
 * Git panel 占位 ─ 当前 git 插件未实装面板,渲染一个友好的 "未接入" 占位。
 * 等 git 插件提供 `rightSidebar.tab` 挂点时,AppShell 切换挂载源。
 */
export function GitPanelPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-(--tmd-fg-faint)">
      Git 面板骨架期未接入,后续由 git 插件提供。
    </div>
  );
}

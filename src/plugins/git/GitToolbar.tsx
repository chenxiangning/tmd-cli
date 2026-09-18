/**
 * GitToolbar —— 面板顶部工具条(2026-09-18 自顶栏嵌入段下移,右侧面板顶部空间吃紧):
 * 三个类型化下拉(视图 / 文件列表布局 / 远端动作;2026-09-19 自单一混合菜单按类拆分,
 * 视图钮常显 icon+文案)+ 聚合增删行数;远端动作行拆至 GitToolbarRemoteRows。
 * 按钮左缘 12px 与下方文件列表分区头(px-3)垂直对齐。状态共享走 panelStore。
 */

import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { t } from "@kernel/i18n";
import { createPortal } from "react-dom";
import {
  ArrowsDownUp,
  GitDiff,
  GitBranch,
  Graph,
  Rows,
  TreeStructure,
} from "@phosphor-icons/react";
import { RemoteActionRows } from "./GitToolbarRemoteRows";
import {
  setGitLayout,
  setGitView,
  useGitPanelState,
  type FileListLayout,
  type GitViewMode,
} from "./panelStore";

const VIEW_LABEL: Record<GitViewMode, string> = {
  diff: "差异",
  branch: "分支",
  history: "历史",
};

/** 视图/列表布局的行前图标(工具条按钮 + 下拉菜单共用)。 */
const VIEW_ICON: Record<GitViewMode, typeof GitDiff> = {
  diff: GitDiff,
  branch: GitBranch,
  history: Graph,
};

const LAYOUT_ICON: Record<FileListLayout, typeof Rows> = {
  flat: Rows,
  tree: TreeStructure,
};

/** 下拉行统一样式(三菜单共用)。 */
const MENU_ITEM =
  "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover)";

type MenuKind = "view" | "layout" | "remote";

/** 菜单宽(视口夹取用):视图/远端行文案长,布局行短。 */
const MENU_WIDTH: Record<MenuKind, number> = { view: 200, layout: 160, remote: 200 };

export function GitToolbar() {
  const { view, layout, aggregate } = useGitPanelState();
  const ViewIcon = VIEW_ICON[view];
  const LayoutIcon = LAYOUT_ICON[layout];
  const totals = aggregate.totals;
  const [menu, setMenu] = useState<{ kind: MenuKind; pos: { x: number; y: number } } | null>(
    null,
  );

  /* 以按钮左缘对齐菜单左缘,视口内夹取(同 wsmenu / panel-overflow 模式)。 */
  const toggleMenu = (kind: MenuKind, e: ReactMouseEvent<HTMLButtonElement>) => {
    if (menu?.kind === kind) {
      setMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const width = MENU_WIDTH[kind];
    setMenu({
      kind,
      pos: {
        x: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        y: Math.min(rect.bottom + 4, window.innerHeight - 300),
      },
    });
  };
  const closeMenu = () => setMenu(null);

  return (
    <div className="flex shrink-0 items-center gap-0.5 whitespace-nowrap border-b border-(--tmd-border) px-2 py-1">
      {totals && (
        <span
          title={t("聚合增删行数(staged + 未暂存;多仓 = 选中仓口径)")}
          className="mr-auto shrink-0 whitespace-nowrap pl-1"
        >
          <span className="text-(--tmd-diff-inserted)">
            +{totals.insertions.toLocaleString("en-US")}
          </span>
          <span className="mx-1 text-(--tmd-fg-faint)">/</span>
          <span className="text-(--tmd-diff-removed)">
            -{totals.deletions.toLocaleString("en-US")}
          </span>
          <span className="ml-1.5 text-(--tmd-fg-muted)">{aggregate.fileCount}</span>
        </span>
      )}
      <button
        type="button"
        onClick={(e) => toggleMenu("view", e)}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-xs font-medium hover:bg-(--tmd-bg-hover)"
      >
        <ViewIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
        <span>{t(VIEW_LABEL[view])}</span>
      </button>
      <button
        type="button"
        onClick={(e) => toggleMenu("layout", e)}
        title={t("文件列表视图")}
        aria-label={t("文件列表视图")}
        className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 hover:bg-(--tmd-bg-hover)"
      >
        <LayoutIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
      </button>
      <button
        type="button"
        onClick={(e) => toggleMenu("remote", e)}
        title={t("远端操作")}
        aria-label={t("远端操作")}
        className="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 hover:bg-(--tmd-bg-hover)"
      >
        <ArrowsDownUp className="h-[0.75rem] w-[0.75rem]" aria-hidden />
      </button>
      {menu?.kind === "view" && (
        <MenuShell position={menu.pos} width={MENU_WIDTH.view} onClose={closeMenu}>
          {(Object.keys(VIEW_LABEL) as GitViewMode[]).map((v) => {
            const VIcon = VIEW_ICON[v];
            return (
              <button
                key={v}
                type="button"
                className={MENU_ITEM}
                onClick={() => {
                  setGitView(v);
                  closeMenu();
                }}
              >
                <span className="flex items-center gap-1.5">
                  <VIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
                  <span>{t(VIEW_LABEL[v])}</span>
                </span>
                {view === v && <span>✓</span>}
              </button>
            );
          })}
        </MenuShell>
      )}
      {menu?.kind === "layout" && (
        <MenuShell position={menu.pos} width={MENU_WIDTH.layout} onClose={closeMenu}>
          {(["flat", "tree"] as const).map((l) => {
            const LIcon = LAYOUT_ICON[l];
            return (
              <button
                key={l}
                type="button"
                className={MENU_ITEM}
                onClick={() => {
                  setGitLayout(l);
                  closeMenu();
                }}
              >
                <span className="flex items-center gap-1.5">
                  <LIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
                  <span>{l === "flat" ? t("平铺") : t("树形")}</span>
                </span>
                {layout === l && <span>✓</span>}
              </button>
            );
          })}
        </MenuShell>
      )}
      {menu?.kind === "remote" && (
        <MenuShell position={menu.pos} width={MENU_WIDTH.remote} onClose={closeMenu}>
          <RemoteActionRows onDone={closeMenu} />
        </MenuShell>
      )}
    </div>
  );
}

/** 类型化下拉的外壳:portal 挂 document.body + fixed(复用 panel-overflow-backdrop/menu,
 *  z 1200+);树内 absolute 会被右栏内容(聚合行 / sticky 组头 / 当前分支行)盖住。 */
function MenuShell({
  position,
  width,
  onClose,
  children,
}: {
  position: { x: number; y: number };
  width: number;
  onClose: () => void;
  children: React.ReactNode;
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
      <div className="panel-overflow-backdrop" role="presentation" onClick={onClose} />
      <div
        className="panel-overflow-menu"
        style={{ left: position.x, top: position.y, minWidth: width }}
        role="menu"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

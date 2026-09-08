/**
 * GitToolbar —— 顶栏嵌入段(对齐 codemoss:视图下拉,与面板 tabs 同行;刷新 ⟳ 在 GitRemoteBar 行)。
 * 经 filePanel 的 toolbar 槽注册;状态共享走 panelStore。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { createPortal } from "react-dom";
import { CaretDown, GitDiff, GitBranch, Graph, Rows, TreeStructure } from "@phosphor-icons/react";
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

/** 视图/列表布局的行前图标(顶栏按钮 + 下拉菜单共用)。 */
const VIEW_ICON: Record<GitViewMode, typeof GitDiff> = {
  diff: GitDiff,
  branch: GitBranch,
  history: Graph,
};
const LAYOUT_ICON: Record<FileListLayout, typeof Rows> = {
  flat: Rows,
  tree: TreeStructure,
};

export function GitToolbar() {
  const { view, layout, aggregate } = useGitPanelState();
  const ViewIcon = VIEW_ICON[view];
  const totals = aggregate.totals;
  const viewBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  /* 以按钮左缘对齐菜单左缘,视口内夹取(同 wsmenu / panel-overflow 模式)。 */
  const toggleMenu = () => {
    if (menuPos) {
      setMenuPos(null);
      return;
    }
    const rect = viewBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 176;
    setMenuPos({
      x: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 240),
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5 whitespace-nowrap">
      <button
        ref={viewBtnRef}
        type="button"
        onClick={toggleMenu}
        className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium hover:bg-(--tmd-bg-hover)"
      >
        <ViewIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
        {menuPos && t(VIEW_LABEL[view])}
        <CaretDown className="h-[0.75rem] w-[0.75rem] text-(--tmd-fg-faint)" aria-hidden />
      </button>
      {totals && (
        <span title={t("聚合增删行数(staged + 未暂存;多仓 = 选中仓口径)")}>
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
      {menuPos && (
        <ViewMenu
          current={view}
          layout={layout}
          position={menuPos}
          onPick={(v) => {
            if (v === "flat" || v === "tree") setGitLayout(v);
            else setGitView(v);
            setMenuPos(null);
          }}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
}

/** 视图下拉:差异/分支/历史 + 平铺/树形。历史视图即 Graph(泳道拓扑)。
 *  portal 挂 document.body + fixed(复用 panel-overflow-backdrop/menu,z 1200+):
 *  树内 absolute 会被右栏内容(聚合行 / sticky 组头 / 当前分支行)盖住。 */
function ViewMenu({
  current,
  layout,
  position,
  onPick,
  onClose,
}: {
  current: GitViewMode;
  layout: FileListLayout;
  position: { x: number; y: number };
  onPick: (v: GitViewMode | FileListLayout) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const item =
    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover)";
  const sep = <div className="my-1 border-t border-(--tmd-border)" />;
  return createPortal(
    <>
      <div className="panel-overflow-backdrop" onClick={onClose} />
      <div
        className="panel-overflow-menu"
        style={{ left: position.x, top: position.y, minWidth: 176 }}
        role="menu"
      >
        {(Object.keys(VIEW_LABEL) as GitViewMode[]).map((v) => {
          const VIcon = VIEW_ICON[v];
          return (
            <button key={v} type="button" className={item} onClick={() => onPick(v)}>
              <span className="flex items-center gap-1.5">
                <VIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
                <span>{t(VIEW_LABEL[v])}</span>
              </span>
              {current === v && <span>✓</span>}
            </button>
          );
        })}
        {sep}
        <div className="px-3 py-1 text-[0.625rem] text-(--tmd-fg-faint)">{t("文件列表视图")}</div>
        {(["flat", "tree"] as const).map((l) => {
          const LIcon = LAYOUT_ICON[l];
          return (
            <button key={l} type="button" className={item} onClick={() => onPick(l)}>
              <span className="flex items-center gap-1.5">
                <LIcon className="h-[0.75rem] w-[0.75rem]" aria-hidden />
                <span>{l === "flat" ? t("平铺") : t("树形")}</span>
              </span>
              {layout === l && <span>✓</span>}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

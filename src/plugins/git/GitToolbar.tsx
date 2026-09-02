/**
 * GitToolbar —— 顶栏嵌入段(对齐 codemoss:视图下拉 + ⟳,与面板 tabs 同行)。
 * 经 filePanel 的 toolbar 槽注册;状态共享走 panelStore。
 */

import { useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import {
  bumpGitRefresh,
  setGitLayout,
  setGitView,
  useGitPanelState,
  type FileListLayout,
  type GitViewMode,
} from "./panelStore";

const VIEW_LABEL: Record<GitViewMode, string> = {
  diff: "差异 Diff",
  branch: "分支",
  history: "历史",
};

export function GitToolbar() {
  const { view, layout } = useGitPanelState();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="relative flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-(--tmd-bg-hover)"
      >
        {VIEW_LABEL[view]}
        <ChevronDown className="h-3 w-3 text-(--tmd-fg-faint)" aria-hidden />
      </button>
      <button
        type="button"
        title="刷新"
        onClick={bumpGitRefresh}
        className="rounded p-1 hover:bg-(--tmd-bg-hover)"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      </button>

      {menuOpen && (
        <ViewMenu
          current={view}
          layout={layout}
          onPick={(v) => {
            if (v === "flat" || v === "tree") setGitLayout(v);
            else setGitView(v);
            setMenuOpen(false);
          }}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}

/** 视图下拉:差异/分支/历史 + 平铺/树形 + Git Graph(disabled 占位)。 */
function ViewMenu({
  current,
  layout,
  onPick,
  onClose,
}: {
  current: GitViewMode;
  layout: FileListLayout;
  onPick: (v: GitViewMode | FileListLayout) => void;
  onClose: () => void;
}) {
  const item =
    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover)";
  const sep = <div className="my-1 border-t border-(--tmd-border)" />;
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-7 z-20 w-44 rounded-md border border-(--tmd-border) bg-(--tmd-bg-popover) py-1 shadow-lg">
        {(Object.keys(VIEW_LABEL) as GitViewMode[]).map((v) => (
          <button key={v} type="button" className={item} onClick={() => onPick(v)}>
            <span>{VIEW_LABEL[v]}</span>
            {current === v && <span>✓</span>}
          </button>
        ))}
        {sep}
        <div className="px-3 py-1 text-[10px] text-(--tmd-fg-faint)">文件列表视图</div>
        {(["flat", "tree"] as const).map((l) => (
          <button key={l} type="button" className={item} onClick={() => onPick(l)}>
            <span>{l === "flat" ? "平铺" : "树形"}</span>
            {layout === l && <span>✓</span>}
          </button>
        ))}
        {sep}
        <button
          type="button"
          className={`${item} cursor-not-allowed opacity-40`}
          disabled
          title="后续版本提供"
        >
          <span>Git Graph</span>
        </button>
      </div>
    </>
  );
}

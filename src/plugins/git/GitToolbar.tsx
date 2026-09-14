/**
 * GitToolbar —— 顶栏嵌入段(tabs 图标之后、⋯ 之前;2026-09-14 口径):
 * 视图下拉(差异/分支/历史 + 平铺/树形)+ 聚合增删行数 + 远端动作行
 * (刷新/获取/拉取/推送,原 GitRemoteBar 四钮收编进下拉)。状态共享走 panelStore。
 */

import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import { createPortal } from "react-dom";
import {
  ArrowClockwise,
  CaretDown,
  CircleNotch,
  CloudArrowDown,
  DownloadSimple,
  GitDiff,
  GitBranch,
  Graph,
  Rows,
  TreeStructure,
  UploadSimple,
} from "@phosphor-icons/react";
import {
  bumpGitRefresh,
  requestRemoteDialog,
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

/** 菜单分组分隔线(常量 JSX 提模块级,不随渲染重建)。 */
const MENU_SEPARATOR = <div className="my-1 border-t border-(--tmd-border)" />;

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
    const width = 200;
    setMenuPos({
      x: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      y: Math.min(rect.bottom + 4, window.innerHeight - 300),
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

/** 远端动作行(原 GitRemoteBar 四钮收编):刷新 / 获取 / 拉取(behind 计数)/ 推送(ahead 计数,accent)。 */
function RemoteActionRows({ onDone }: { onDone: () => void }) {
  const { remoteMeta } = useGitPanelState();
  const meta = remoteMeta;
  const busy = meta?.busy ?? null;
  const detached = meta?.detached ?? false;
  const hasUpstream = meta?.hasUpstream ?? false;
  const ahead = meta?.ahead ?? 0;
  const behind = meta?.behind ?? 0;
  const item =
    "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-50";
  const rows: Array<{
    key: "refresh" | "fetch" | "pull" | "push";
    label: string;
    title: string;
    icon: typeof ArrowClockwise;
    disabled: boolean;
    active: boolean;
    accent: boolean;
    count: number;
    run: () => void;
  }> = [
    {
      key: "refresh",
      label: t("刷新"),
      title: t("刷新(重扫状态/分支/历史)"),
      icon: ArrowClockwise,
      disabled: false,
      active: false,
      accent: false,
      count: 0,
      run: bumpGitRefresh,
    },
    {
      key: "fetch",
      label: t("获取"),
      title: t("获取远端更新(fetch --all --prune,不动本地分支)"),
      icon: CloudArrowDown,
      disabled: busy !== null || detached,
      active: busy === "fetch",
      accent: false,
      count: 0,
      run: () => requestRemoteDialog("fetch"),
    },
    {
      key: "pull",
      label: t("拉取"),
      title:
        behind > 0
          ? t("拉取远端更新(落后 {n} 个提交)", { n: behind })
          : t("拉取远端更新(对话框内可选远端与分支)"),
      icon: DownloadSimple,
      disabled: busy !== null || detached,
      active: busy === "pull" || behind > 0,
      accent: false,
      count: behind,
      run: () => requestRemoteDialog("pull"),
    },
    {
      key: "push",
      label: t("推送"),
      title:
        ahead > 0
          ? hasUpstream
            ? t("推送 {n} 个提交(对话框内可预览)", { n: ahead })
            : t("推送新分支并建立 upstream")
          : t("推送(对话框内查看预览与选项)"),
      icon: UploadSimple,
      disabled: busy !== null || detached,
      active: busy === "push" || ahead > 0,
      accent: ahead > 0,
      count: ahead,
      run: () => requestRemoteDialog("push"),
    },
  ];
  return (
    <>
      {MENU_SEPARATOR}
      {rows.map((r) => {
        const Icon = r.active && busy === r.key ? CircleNotch : r.icon;
        return (
          <button
            key={r.key}
            type="button"
            className={`${item}${r.active ? " has-state" : ""}${r.accent ? " text-(--tmd-accent)" : ""}`}
            title={r.title}
            disabled={r.disabled}
            onClick={() => {
              r.run();
              onDone();
            }}
          >
            <span className="flex items-center gap-1.5">
              <Icon
                className={`h-[0.75rem] w-[0.75rem]${busy === r.key ? " animate-spin" : ""}`}
                aria-hidden
              />
              <span>{r.label}</span>
            </span>
            {r.count > 0 && <span>{r.count}</span>}
          </button>
        );
      })}
    </>
  );
}

/** 视图下拉:差异/分支/历史 + 平铺/树形 + 远端动作行。历史视图即 Graph(泳道拓扑)。
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
  return createPortal(
    <>
      <div className="panel-overflow-backdrop" role="presentation" onClick={onClose} />
      <div
        className="panel-overflow-menu"
        style={{ left: position.x, top: position.y, minWidth: 200 }}
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
        {MENU_SEPARATOR}
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
        <RemoteActionRows onDone={onClose} />
      </div>
    </>,
    document.body,
  );
}

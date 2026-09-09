/**
 * Right panel toolbar —— 复刻 codemoss right-panel-toolbar 视觉。
 *
 * 拆分后:
 * - TopBarPanelTabs: panel tab 按钮 + ⋯ more ─ 由 TopBar 渲染到顶部
 *   titlebar 右侧,与 search/quick-switcher 等其他 action 同一行。
 * - WorkspaceSubbar: workspace label + 文件操作按钮 ─ 由右侧 aside 顶部渲染。
 * - RightPanelToolbar: 内部组件,仅在右侧 aside 渲染 WorkspaceSubbar。
 */

import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, DotsThree, FilePlus, FolderSimplePlus, ArrowClockwise } from "@phosphor-icons/react";
import {
  setFilePanelMode,
  togglePinned,
  useFilePanel,
  type FilePanelContribution,
} from "@kernel/filePanel";
import { useWorkspaces, workspaceDisplayName } from "@kernel/workspace";
import { t } from "@kernel/i18n";


/* ──────────────────────────────────────────────────────────
 * TopBar 用 panel tabs 组件 ─ 由 header.right 挂点提供。
 * tab 列表完全来自 kernel 面板注册表,外壳不认识任何业务面板。
 * ────────────────────────────────────────────────────────── */
export function TopBarPanelTabs() {
  const { mode, pinnedIds, panels } = useFilePanel();
  const [overflowPos, setOverflowPos] = useState<{ x: number; y: number } | null>(null);
  /* 激活面板的顶栏嵌入段(如 git 的视图下拉 + ⟳) */
  const ActiveToolbar = panels.find((p) => p.id === mode)?.toolbar;

  /* 外显 tab = 已钉住 + 当前激活(未钉也临时外显) */
  const visiblePanels = panels.filter(
    (p) => p.topbarEntry !== false && (pinnedIds.has(p.id) || p.id === mode),
  );

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
      {ActiveToolbar ? <ActiveToolbar /> : null}
      <div className="panel-tabs" role="tablist" aria-label={t("右侧面板")}>
        {visiblePanels.map((panel) => {
          const Icon = panel.icon;
          const isActive = panel.id === mode;
          return (
            <button
              key={panel.id}
              type="button"
              className={`panel-tab${isActive ? " is-active" : ""}`}
              data-panel-id={panel.id}
              onClick={() => setFilePanelMode(panel.id)}
              aria-label={t(panel.label)}
              title={t(panel.label)}
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
        aria-label={t("更多面板")}
        title={t("更多面板")}
      >
        <DotsThree aria-hidden />
      </button>

      {overflowPos ? (
        <PanelOverflowMenu
          mode={mode}
          pinnedIds={pinnedIds}
          panels={panels}
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
  panels,
  position,
  onClose,
}: {
  mode: string;
  pinnedIds: ReadonlySet<string>;
  panels: readonly FilePanelContribution[];
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
        {panels
          .filter((p) => p.topbarEntry !== false)
          .map((panel) => {
          const Icon = panel.icon;
          const isActive = panel.id === mode;
          const isChecked = pinnedIds.has(panel.id);
          return (
            <div
              key={panel.id}
              className={`panel-overflow-item${isActive ? " is-active" : ""}`}
              data-panel-id={panel.id}
              role="menuitem"
              onClick={() => {
                setFilePanelMode(panel.id);
                if (!isChecked) togglePinned(panel.id);
                onClose();
              }}
            >
              <span className="panel-overflow-item-icon" aria-hidden>
                <Icon aria-hidden />
              </span>
              <span className="panel-overflow-item-label">{t(panel.label)}</span>
              <span
                className={`panel-overflow-item-check${isChecked ? " is-checked" : ""}`}
                role="checkbox"
                aria-checked={isChecked}
                title={t("钉到工具条")}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePinned(panel.id);
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
function WorkspaceSubbar() {
  const { list, activeId } = useWorkspaces();
  const active = list.find((w) => w.id === activeId) ?? list[0];
  const root = active?.root;
  /* 不用 useMemo:alias 原地变更(list 项引用不变)会滞 stale;取名字符串操作本就廉价。 */
  const label = active ? workspaceDisplayName(active).toUpperCase() : "";
  /* 刷新/新建文件/新建文件夹:调激活面板注册的对应槽;刷新 in-flight 转圈。 */
  const { mode, panels } = useFilePanel();
  const activePanel = panels.find((p) => p.id === mode);
  const activeRefresh = activePanel?.refresh;
  const [refreshBusy, setRefreshBusy] = useState(false);
  const refreshBatchRef = useRef(0);

  const handleRefreshFiles = () => {
    if (!activeRefresh || refreshBusy) return;
    const myBatch = ++refreshBatchRef.current;
    setRefreshBusy(true);
    /* refresh 实现经 .then 调用:同步抛错也归入 rejection,finally 必然清转圈 */
    void Promise.resolve()
      .then(activeRefresh)
      .finally(() => {
        if (refreshBatchRef.current === myBatch) setRefreshBusy(false);
      });
  };

  if (!root) return null;

  return (
    <div className="panel-subbar">
      <span className="panel-subbar-label" title={root}>{label}</span>
      <span className="panel-subbar-actions">
        <button
          type="button"
          className="panel-subbar-action"
          aria-label={t("新建文件")}
          title={t("新建文件")}
          disabled={!activePanel?.newFile}
          onClick={() => activePanel?.newFile?.()}
        >
          <FilePlus size="0.75rem" aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label={t("新建文件夹")}
          title={t("新建文件夹")}
          disabled={!activePanel?.newFolder}
          onClick={() => activePanel?.newFolder?.()}
        >
          <FolderSimplePlus size="0.75rem" aria-hidden />
        </button>
        <button
          type="button"
          className="panel-subbar-action"
          aria-label={t("刷新文件树")}
          title={t("刷新文件树")}
          onClick={handleRefreshFiles}
        >
          <ArrowClockwise
            size="0.75rem"
            aria-hidden
            className={refreshBusy ? "animate-spin" : undefined}
          />
        </button>
        {activePanel?.actions ? <activePanel.actions /> : null}
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────
 * AppShell 右栏 aside 的渲染入口(panel tabs 已挪到 TopBarPanelTabs)。
 * ────────────────────────────────────────────────────────── */
/* memo 兜底:无 props,父级(AppShell 右栏 aside)重渲染时不再连带重渲染。 */
export const RightPanelToolbar = memo(function RightPanelToolbar() {
  /* 是否显示 workspace 文件行由面板注册时自声明(showFileSubbar,缺省 true)——
     外壳不认识任何业务面板 id。 */
  const { mode, panels } = useFilePanel();
  const show = panels.find((p) => p.id === mode)?.showFileSubbar !== false;
  if (!show) return null;
  return (
    <div className="right-panel-toolbar">
      <WorkspaceSubbar />
    </div>
  );
});

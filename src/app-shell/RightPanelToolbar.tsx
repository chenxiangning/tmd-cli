/**
 * Right panel toolbar —— 复刻 codemoss right-panel-toolbar 视觉。
 *
 * 拆分后:
 * - TopBarPanelTabs: panel tab 按钮 + ⋯ more ─ 由 TopBar 渲染到顶部
 *   titlebar 右侧,与 search/quick-switcher 等其他 action 同一行。
 * - RightPanelToolbar: 内部组件,在右侧 aside 底部渲染 FileActionsBar
 *   (新建/刷新/面板动作;工作区选择器 2026-09-14 上移顶栏 WorkspaceSwitcher)。
 */

import { memo, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, DotsThree } from "@phosphor-icons/react";
import {
  setFilePanelMode,
  togglePinned,
  useFilePanel,
  type FilePanelContribution,
} from "@kernel/filePanel";
import { t } from "@kernel/i18n";
import { FileActionsBar } from "./FileActionsBar";


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
      <div className="panel-overflow-backdrop" role="presentation" onClick={onClose} />
      <div className="panel-overflow-menu" style={{ left: position.x, top: position.y }} role="menu">
        {/* 单趟 flatMap:topbarEntry === false 的面板不进溢出菜单。 */}
        {panels.flatMap((panel) => {
          if (panel.topbarEntry === false) return [];
          const Icon = panel.icon;
          const isActive = panel.id === mode;
          const isChecked = pinnedIds.has(panel.id);
          return [
            <div
              key={panel.id}
              className={`panel-overflow-item${isActive ? " is-active" : ""}`}
              data-panel-id={panel.id}
            >
              {/* 激活动作 = 原生 button 占满图标+标签区(内联样式复刻原 flex 布局);
                  钉选复选框是并列兄弟,不嵌套在交互元素内(嵌套会丢焦点语义)。 */}
              <button
                type="button"
                role="menuitem"
                style={{
                  flex: "1 1 auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  minWidth: 0,
                  padding: 0,
                  border: "none",
                  background: "none",
                  font: "inherit",
                  color: "inherit",
                  cursor: "inherit",
                  textAlign: "left",
                }}
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
              </button>
              <span
                className={`panel-overflow-item-check${isChecked ? " is-checked" : ""}`}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                title={t("钉到工具条")}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePinned(panel.id);
                }}
                onKeyDown={(e) => {
                  if (e.key !== " " && e.key !== "Enter") return;
                  e.preventDefault();
                  togglePinned(panel.id);
                }}
              >
                {isChecked ? <Check aria-hidden /> : null}
              </span>
            </div>,
          ];
        })}
      </div>
    </>,
    document.body,
  );
}


/* ──────────────────────────────────────────────────────────
 * AppShell 右栏 aside 的渲染入口(panel tabs 已挪到 TopBarPanelTabs)。
 * ────────────────────────────────────────────────────────── */
/* memo 兜底:无 props,父级(AppShell 右栏 aside)重渲染时不再连带重渲染。 */
export const RightPanelToolbar = memo(function RightPanelToolbar() {
  /* 是否显示底部文件操作条由面板注册时自声明(showFileSubbar,缺省 true)——
     外壳不认识任何业务面板 id。 */
  const { mode, panels } = useFilePanel();
  const show = panels.find((p) => p.id === mode)?.showFileSubbar !== false;
  if (!show) return null;
  return <FileActionsBar />;
});

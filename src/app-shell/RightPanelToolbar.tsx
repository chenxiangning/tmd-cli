/**
 * Right panel rail —— 右缘常驻竖排面板入口(2026-09-26 自顶栏 tab 条迁来,UI 参照 activity bar)。
 *
 * 拆分后:
 * - PanelRail: 窗口右缘竖条(钉住∪激活面板 + 分隔线 + ⋯ more 向左弹出),
 *   由 AppShell 渲染在内容行最右;点击 = 切面板并自动展开右栏。
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
import { useSidebarActions } from "@kernel/sidebarActions";
import { useEditorTabs } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { FileActionsBar } from "./FileActionsBar";


/* ──────────────────────────────────────────────────────────
 * 右缘面板 rail ─ AppShell 渲染在内容行最右(header.right 挂点仍在顶栏,由插件贡献)。
 * tab 列表完全来自 kernel 面板注册表,外壳不认识任何业务面板。
 * ────────────────────────────────────────────────────────── */
export function PanelRail({ onActivate }: { onActivate: () => void }) {
  const { mode, pinnedIds, panels } = useFilePanel();
  const [overflowPos, setOverflowPos] = useState<{ x: number; y: number } | null>(null);
  /* rail 直挂动作(如 WSL):active() 多依赖中央 tab 态,订阅 tabs 保重渲。 */
  const railActions = useSidebarActions().filter((a) => a.rail);
  useEditorTabs();

  /* 外显 tab = 已钉住 + 当前激活(未钉也临时外显) */
  const visiblePanels = panels.filter(
    (p) => p.railEntry !== false && (pinnedIds.has(p.id) || p.id === mode),
  );

  const toggleOverflow = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (overflowPos) {
      setOverflowPos(null);
      return;
    }
    // ⋯ 在右缘竖条:菜单贴按钮左缘向左弹出,视口内夹取(同 wsmenu 模式)。
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 240;
    const estHeight = 320; // ponytail: 菜单估高(约 7 行)只用于夹取,真值由内容撑开
    setOverflowPos({
      x: Math.max(12, rect.left - width - 4),
      y: Math.max(12, Math.min(rect.top, window.innerHeight - estHeight - 12)),
    });
  };
  return (
    <div className="panel-rail">
      <div className="panel-rail-tabs" role="tablist" aria-orientation="vertical" aria-label={t("右侧面板")}>
        {visiblePanels.map((panel) => {
          const Icon = panel.icon;
          const isActive = panel.id === mode;
          return (
            <button
              key={panel.id}
              type="button"
              className={`panel-rail-tab${isActive ? " is-active" : ""}`}
              data-panel-id={panel.id}
              onClick={() => {
                setFilePanelMode(panel.id);
                onActivate();
              }}
              aria-label={t(panel.label)}
              title={t(panel.label)}
            >
              <Icon aria-hidden />
            </button>
          );
        })}
      </div>

      {/* rail 直挂动作(sidebarActions.rail):面板 tab 组之后、分隔线之前 */}
      {railActions.map((action) => {
        const Icon = action.icon;
        const isActive = action.active?.() ?? false;
        return (
          <button
            key={action.id}
            type="button"
            className={`panel-rail-tab${isActive ? " is-active" : ""}`}
            data-action-id={action.id}
            aria-label={t(action.label)}
            aria-pressed={isActive}
            title={t(action.label)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              action.onSelect({ x: r.left - 8, y: r.top });
            }}
          >
            <Icon aria-hidden />
          </button>
        );
      })}

      {/* 参照图:tab 组下一条分隔线,⋯ 组紧随其后(不钉底) */}
      <div className="panel-rail-sep" aria-hidden />

      <button
        type="button"
        className="panel-rail-tab"
        onClick={toggleOverflow}
        aria-label={t("更多面板")}
        aria-expanded={overflowPos ? true : undefined}
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
 * 跳出 rail 层叠上下文,杜绝被文件树压住/背景透明;自 rail 向左弹出。
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
        {/* 单趟 flatMap:railEntry === false 的面板不进溢出菜单。 */}
        {panels.flatMap((panel) => {
          if (panel.railEntry === false) return [];
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
 * AppShell 右栏 aside 的渲染入口(面板入口已迁右缘 PanelRail)。
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

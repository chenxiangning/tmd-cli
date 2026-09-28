/**
 * Right panel rail —— 右缘常驻竖排面板入口(2026-09-26 自顶栏 tab 条迁来,UI 参照 activity bar)。
 *
 * 拆分后:
 * - PanelRail: 窗口右缘竖条(钉住∪激活面板 + 分隔线 + ⋯ more 向左弹出),
 *   由 AppShell 渲染在内容行最右;点击 = 切面板并自动展开右栏。
 * - RightPanelToolbar: 内部组件,在顶栏右区(titlebar-actions 右缘)渲染
 *   FileActionsBar(新建/刷新/面板动作;工作区选择器 2026-09-14 上移顶栏,
 *   操作条 2026-09-27 自右栏底部同步上移)。
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
import { useSidebarActions, type SidebarAction } from "@kernel/sidebarActions";
import { useHost } from "@kernel/host";
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
  const railActions = useSidebarActions().filter((a) => a.rail);
  useEditorTabs(); /* rail 直挂动作 active() 靠中央 tab 态(WSL),订阅保重渲 */
  useHost(); /* 同上,内置终端 active() 靠活跃会话态,订阅保重渲 */
  /* 外显动作 = 钉住 ∪ 激活(与面板 tab 同规则;未钉可经 ⋯ 菜单勾回)。 */
  const visibleRailActions = railActions.filter(
    (a) => pinnedIds.has(a.id) || (a.active?.() ?? false),
  );

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
                panel.openCenterTab?.();
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
      {visibleRailActions.map((action) => {
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
              action.onSelect({ x: r.left - 8, y: r.top }, { altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
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
          railActions={railActions}
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
/** ⋯ 菜单行激活按钮的内联样式(面板行与 rail 动作行共用,复刻原 flex 布局)。 */
const MENU_ITEM_BUTTON_STYLE = {
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
} as const;

/** 钉选复选框(面板行与 rail 动作行共用):点击/键盘勾选 = 仅切换钉住,菜单不关。 */
function PinCheck({ id, checked }: { id: string; checked: boolean }) {
  return (
    <span
      className={`panel-overflow-item-check${checked ? " is-checked" : ""}`}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      title={t("钉到工具条")}
      onClick={(e) => {
        e.stopPropagation();
        togglePinned(id);
      }}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        togglePinned(id);
      }}
    >
      {checked ? <Check aria-hidden /> : null}
    </span>
  );
}

function PanelOverflowMenu({
  mode,
  pinnedIds,
  panels,
  railActions,
  position,
  onClose,
}: {
  mode: string;
  pinnedIds: ReadonlySet<string>;
  panels: readonly FilePanelContribution[];
  railActions: readonly SidebarAction[];
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
                style={MENU_ITEM_BUTTON_STYLE}
                onClick={() => {
                  setFilePanelMode(panel.id);
                  panel.openCenterTab?.();
                  if (!isChecked) togglePinned(panel.id);
                  onClose();
                }}
              >
                <span className="panel-overflow-item-icon" aria-hidden>
                  <Icon aria-hidden />
                </span>
                <span className="panel-overflow-item-label">{t(panel.label)}</span>
              </button>
              <PinCheck id={panel.id} checked={isChecked} />
            </div>,
          ];
        })}
        {/* rail 直挂动作行:点击 = 触发动作(不开面板模式),勾选 = 钉/取钉 rail 外显。 */}
        {railActions.map((action) => {
          const Icon = action.icon;
          const isActive = action.active?.() ?? false;
          const isChecked = pinnedIds.has(action.id);
          return (
            <div
              key={action.id}
              className={`panel-overflow-item${isActive ? " is-active" : ""}`}
              data-action-id={action.id}
            >
              <button
                type="button"
                role="menuitem"
                style={MENU_ITEM_BUTTON_STYLE}
                onClick={() => {
                  action.onSelect({ x: position.x, y: position.y });
                  onClose();
                }}
              >
                <span className="panel-overflow-item-icon" aria-hidden>
                  <Icon aria-hidden />
                </span>
                <span className="panel-overflow-item-label">{t(action.label)}</span>
              </button>
              <PinCheck id={action.id} checked={isChecked} />
            </div>
          );
        })}
      </div>
    </>,
    document.body,
  );
}


/* ──────────────────────────────────────────────────────────
 * 顶栏右区渲染入口(TopBar titlebar-actions,右栏展开才挂;面板入口已迁右缘 PanelRail)。
 * ────────────────────────────────────────────────────────── */
/* memo 兜底:无 props,父级(TopBar 右区)重渲染时不再连带重渲染。 */
export const RightPanelToolbar = memo(function RightPanelToolbar() {
  /* 是否显示文件操作条由面板注册时自声明(showFileSubbar,缺省 true)——
     外壳不认识任何业务面板 id;当前仅 files 面板为缺省 true。 */
  const { mode, panels } = useFilePanel();
  const show = panels.find((p) => p.id === mode)?.showFileSubbar !== false;
  if (!show) return null;
  return <FileActionsBar />;
});

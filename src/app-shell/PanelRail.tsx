/**
 * Right panel rail —— 右缘常驻竖排面板入口(2026-09-26 自顶栏 tab 条迁来,UI 参照 activity bar)。
 *
 * 文件名即内容:本文件只有 PanelRail(2026-10-02 更名自 RightPanelToolbar.tsx ——
 * 其顶栏右区渲染职责 FileActionsBar 已随文件操作条下放面板头移除)。
 * 窗口右缘竖条(钉住∪激活面板 + rail 动作统一并序,组间分隔线,
 * ⋯ more 向左弹出),由 AppShell 渲染在内容行最右;点击 = 切面板并自动展开右栏。
 * 悬停提示走全局 data-hint;rail 贴右缘,加 data-hint-side="left" 让气泡
 * 抽屉式贴图标左缘滑出(kernel/Tooltip 的 left 放置模式),不再远距离弹窗。
 */

import { Fragment, useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Check, DotsThree } from "@phosphor-icons/react";
import { togglePinned, useFilePanel, type FilePanelContribution } from "@kernel/filePanel";
import { useSidebarActions, type SidebarAction } from "@kernel/sidebarActions";
import { useHost } from "@kernel/host";
import { DecorIcon } from "@kernel/iconSet";
import { useEditorTabs } from "@kernel/tabs";
import { t } from "@kernel/i18n";
import { activateRailPanel } from "./railPanelActivate";


/* ──────────────────────────────────────────────────────────
 * 右缘面板 rail ─ AppShell 渲染在内容行最右(header.right 挂点仍在顶栏,由插件贡献)。
 * tab 列表完全来自 kernel 面板注册表,外壳不认识任何业务面板。
 * ────────────────────────────────────────────────────────── */

/** 面板 + rail 动作的并序条目(kind 判别联合):order 是两组共享的地带,
 *  按它统一排序;group(railGroup)相邻变组处由渲染点画分隔线。 */
type RailEntry =
  | { kind: "panel"; id: string; order: number; group: string | undefined; panel: FilePanelContribution }
  | { kind: "action"; id: string; order: number; group: string | undefined; action: SidebarAction };

function mergeRailEntries(panels: readonly FilePanelContribution[], actions: readonly SidebarAction[]): RailEntry[] {
  return [
    ...panels.map((p): RailEntry => ({ kind: "panel", id: p.id, order: p.order ?? 0, group: p.railGroup, panel: p })),
    ...actions.map((a): RailEntry => ({ kind: "action", id: a.id, order: a.order ?? 0, group: a.railGroup, action: a })),
  ].sort((x, y) => x.order - y.order);
}

export function PanelRail({
  rightOpen,
  setRightOpen,
}: {
  rightOpen: boolean;
  setRightOpen: (open: boolean) => void;
}) {
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
  const visiblePanels = panels.filter((p) => pinnedIds.has(p.id) || p.id === mode);

  /* 面板与 rail 动作统一并序(2026-09-29 归组);相邻 railGroup 变组处画分隔线,
     组语义归插件声明(注册面),壳只比较相邻值,不认识任何组。
     railBottom 声明底簇:渲染在弹性空隙之后,与 ⋯ 管理钮同挂底部。 */
  const entries = mergeRailEntries(visiblePanels, visibleRailActions);
  const isBottom = (e: RailEntry) => (e.kind === "panel" ? e.panel.railBottom : e.action.railBottom);
  const topEntries = entries.filter((e) => !isBottom(e));
  const bottomEntries = entries.filter(isBottom);

  const toggleOverflow = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (overflowPos) {
      setOverflowPos(null);
      return;
    }
    // ⋯ 在右缘竖条:菜单贴按钮左缘向左弹出,视口内夹取(同 wsmenu 模式)。
    const rect = e.currentTarget.getBoundingClientRect();
    const width = 240;
    const estHeight = 440; // ponytail: 菜单估高(12 行 + 组分隔线)只用于夹取,真值由内容撑开
    setOverflowPos({
      x: Math.max(12, rect.left - width - 4),
      y: Math.max(12, Math.min(rect.top, window.innerHeight - estHeight - 12)),
    });
  };
  /* 单条渲染(面板/动作分支):prev 用于组间分隔线判定,顶簇/底簇各自独立成列。 */
  const renderEntry = (entry: RailEntry, prev: RailEntry | undefined) => {
    const sep = prev?.group !== undefined && entry.group !== undefined && prev.group !== entry.group;
    if (entry.kind === "panel") {
      const { panel } = entry;
      const isActive = panel.id === mode;
      /* 开/合可分辨:aria-pressed 如实反映「激活且展开」;激活但折叠降级半透明
       * (is-collapsed),「开着」与「激活但收起」不再同貌。 */
      const isOpen = isActive && rightOpen;
      return (
        <Fragment key={panel.id}>
          {sep ? <div className="panel-rail-sep" aria-hidden /> : null}
          <button type="button" className={`panel-rail-tab${isActive ? " is-active" : ""}${isActive && !rightOpen ? " is-collapsed" : ""}`} data-panel-id={panel.id}
            onClick={() => activateRailPanel(panel, { mode, rightOpen, setRightOpen })}
            aria-label={t(panel.label)} aria-pressed={isOpen} data-hint={t(panel.label)} data-hint-side="left" title="">
            <DecorIcon id={panel.id === "ssh" ? "ssh-panel" : `panel-${panel.id}`} Fallback={panel.icon} aria-hidden />
          </button>
        </Fragment>
      );
    }
    const { action } = entry;
    const isActive = action.active?.() ?? false;
    return (
      <Fragment key={action.id}>
        {sep ? <div className="panel-rail-sep" aria-hidden /> : null}
        <button type="button" className={`panel-rail-tab${isActive ? " is-active" : ""}`} data-action-id={action.id}
          aria-label={t(action.label)} aria-pressed={isActive} data-hint={t(action.label)} data-hint-side="left" title=""
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            action.onSelect({ x: r.left - 8, y: r.top }, { altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey });
            if (action.opensCenterTab) setRightOpen(false);
          }}>
          <DecorIcon id={action.id} Fallback={action.icon} aria-hidden />
        </button>
      </Fragment>
    );
  };
  return (
    <div className="panel-rail" role="toolbar" aria-orientation="vertical" aria-label={t("右侧面板")}>
      {topEntries.map((e, i) => renderEntry(e, topEntries[i - 1]))}
      <div className="panel-rail-spacer" aria-hidden />
      <i className="panel-rail-mark" aria-hidden>tmd-cli</i> {/* 签名:纯装饰,rail 流内项,钉在底簇正上方(CSS 注释同款纪律) */}
      {bottomEntries.map((e, i) => renderEntry(e, bottomEntries[i - 1]))}
      <button type="button" className="panel-rail-tab" onClick={toggleOverflow}
        aria-label={t("更多面板")} aria-expanded={overflowPos ? true : undefined} data-hint={t("更多面板")} data-hint-side="left" title="">
        <DotsThree aria-hidden />
      </button>
      {overflowPos ? (
        <PanelOverflowMenu
          mode={mode}
          pinnedIds={pinnedIds}
          panels={panels}
          railActions={railActions}
          position={overflowPos}
          rightOpen={rightOpen}
          setRightOpen={setRightOpen}
          onClose={() => setOverflowPos(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 更多面板下拉(⋯) —— portal 挂 document.body + fixed 定位(复刻 wsmenu 模式),
 * 跳出 rail 层叠上下文,杜绝被文件树压住/背景透明;自 rail 向左弹出。
 * 行点击 = 激活该面板(未钉则顺带钉上);复选框点击 = 仅切换钉住状态,菜单不关。 */
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
  rightOpen,
  setRightOpen,
  onClose,
}: {
  mode: string;
  pinnedIds: ReadonlySet<string>;
  panels: readonly FilePanelContribution[];
  railActions: readonly SidebarAction[];
  position: { x: number; y: number };
  rightOpen: boolean;
  setRightOpen: (open: boolean) => void;
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
      {/* 混合选择弹层(激活按钮 + 钉选复选框),非纯 ARIA menu,不挂 menu/menuitem 角色。 */}
      <div className="panel-overflow-menu" style={{ left: position.x, top: position.y }} role="group" aria-label={t("面板与动作")}>
        {/* 面板与 rail 动作同口径并序分组;
            组间分隔线与 rail 一致,行点击语义随 kind 分流。 */}
        {mergeRailEntries(panels, railActions).map((entry, i, items) => {
          const prev = items[i - 1];
          const sep = prev?.group !== undefined && entry.group !== undefined && prev.group !== entry.group;
          if (entry.kind === "panel") {
            const { panel } = entry;
            const Icon = panel.icon;
            const isActive = panel.id === mode;
            const isChecked = pinnedIds.has(panel.id);
            return (
              <Fragment key={panel.id}>
                {sep ? <hr className="panel-overflow-sep" /> : null}
                {/* 激活动作 = 原生 button 占满图标+标签区(panel-overflow-item-btn);
                    钉选复选框是并列兄弟,不嵌套在交互元素内(嵌套会丢焦点语义)。 */}
                <div className={`panel-overflow-item${isActive ? " is-active" : ""}`} data-panel-id={panel.id}>
                  <button type="button" className="panel-overflow-item-btn"
                    onClick={() => {
                      activateRailPanel(panel, { mode, rightOpen, setRightOpen });
                      if (!isChecked) togglePinned(panel.id);
                      onClose();
                    }}>
                    <span className="panel-overflow-item-icon" aria-hidden>
                      <DecorIcon id={panel.id === "ssh" ? "ssh-panel" : `panel-${panel.id}`} Fallback={Icon} aria-hidden /></span>
                    <span className="panel-overflow-item-label">{t(panel.label)}</span>
                  </button>
                  <PinCheck id={panel.id} checked={isChecked} />
                </div>
              </Fragment>
            );
          }
          const { action } = entry;
          const AIcon = action.icon;
          const isActive = action.active?.() ?? false;
          const isChecked = pinnedIds.has(action.id);
          return (
            <Fragment key={action.id}>
              {sep ? <hr className="panel-overflow-sep" /> : null}
              {/* 动作行:点击 = 触发动作(不开面板模式),勾选 = 钉/取钉 rail 外显。 */}
              <div className={`panel-overflow-item${isActive ? " is-active" : ""}`} data-action-id={action.id}>
                <button type="button" className="panel-overflow-item-btn"
                  onClick={() => {
                    action.onSelect({ x: position.x, y: position.y });
                    if (action.opensCenterTab) setRightOpen(false);
                    onClose();
                  }}>
                  <span className="panel-overflow-item-icon" aria-hidden>
                    <DecorIcon id={action.id} Fallback={AIcon} aria-hidden /></span>
                  <span className="panel-overflow-item-label">{t(action.label)}</span>
                </button>
                <PinCheck id={action.id} checked={isChecked} />
              </div>
            </Fragment>
          );
        })}
      </div>
    </>,
    document.body,
  );
}

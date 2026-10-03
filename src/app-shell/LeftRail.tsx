/**
 * Left panel rail —— 左缘常驻竖排入口(2026-10-04,右缘 PanelRail 的镜像)。
 *
 * 条目两源合并,按 order 统一排序(组语义与右 rail 同纪律):
 * - 插件动作:kernel/sidebarActions 里声明 leftRail 的条目(session-board 顶部簇
 *   开看板覆盖层),壳只渲染注册表、不认识业务;
 * - 壳自有功能:插件市场(marketOpen 态)/ 回到首页(toggleHomeSession,市场
 *   覆盖层开着先收掉)/ 工作区切换(下拉复用 WorkspaceSwitcher 的菜单簇 hook)。
 * 顶栏不再放这三钮(2026-10-04 用户口径:移入左 rail,顶栏左区只留挂点+折栏)。
 * 底簇再钉设置菜单触发钮(同日迁入,原侧栏底栏 logo 入口;菜单本体仍在
 * SidebarSettingsCluster,开合经 AppShell 受控)。
 * 悬停提示走全局 data-hint;rail 贴左缘,加 data-hint-side="right" 让气泡
 * 抽屉式贴图标右缘滑出(kernel/Tooltip 的 right 放置模式)。
 */

import type { ComponentType, MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useReducer } from "react";
import { FolderOpen, Plug, Tray } from "@phosphor-icons/react";
import { DecorIcon } from "@kernel/iconSet";
import { t } from "@kernel/i18n";
import { useSidebarActions, type SidebarAction } from "@kernel/sidebarActions";
import { toggleHomeSession } from "./shortcutCommands";
import { useWorkspaceSwitchMenus } from "./WorkspaceSwitcher";
import logoUrl from "../assets/logo.png";

/** 左 rail 条目(kind 判别联合):order 跨两源统一排序;bottom 钉底部簇。 */
type LeftEntry =
  | { kind: "action"; id: string; order: number; bottom: boolean; action: SidebarAction }
  | {
      kind: "shell";
      id: string;
      order: number;
      bottom: boolean;
      label: string;
      icon: ComponentType<{ size?: number | string; className?: string }>;
      active?: boolean;
      hintCmd?: string;
      onSelect: (rect: DOMRect, e: ReactMouseEvent<HTMLButtonElement>) => void;
      /** 右键菜单(可选):与顶栏同款的活动工作区行菜单(WorkspaceRowMenu)。 */
      onContextMenu?: (rect: DOMRect, e: ReactMouseEvent<HTMLButtonElement>) => void;
    };

export function LeftRail({
  marketOpen,
  onToggleMarket,
  settingsOpen,
  onToggleSettings,
}: {
  marketOpen: boolean;
  onToggleMarket: () => void;
  /** 设置菜单开合(归 AppShell):本 rail 只持触发钮,菜单本体在左下簇。 */
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  /* registry 快照身份稳定(仅注册/注销换新);filter 结果 memo 钉住引用,
   * 下方订阅 effect 不随本组件重渲空转退订/重订。 */
  const registry = useSidebarActions();
  const actions = useMemo(() => registry.filter((a) => a.leftRail), [registry]);
  /* active 契约的宿主重渲义务(sidebarActions:渲染期求值,响应性随宿主):
   * 私有 store 驱动类(看板覆盖层)经动作自声明的 subscribeActive 统一订阅,
   * bump 强制重渲求值 —— 与 PanelRail 的 useEditorTabs/useHost「订阅保重渲」
   * 同纪律(设置驱动类出现时再补 useSettingsState,先例 PanelRail)。 */
  const [, bumpActive] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    /* dispatch 引用恒稳;actions = 注册表快照,registry 变化 → 重订阅。 */
    const offs = actions.map((a) => a.subscribeActive?.(bumpActive));
    return () => offs.forEach((off) => off?.());
  }, [actions]);
  /* 工作区切换菜单簇(下拉 + 行右键菜单):与顶栏 WorkspaceSwitcher 共用一套。 */
  const wsMenus = useWorkspaceSwitchMenus();

  /* 壳自有条目(排序位与插件动作共享同一地带):市场 20 / 首页 30 / 工作区 40。 */
  const shellEntries: LeftEntry[] = [
    {
      kind: "shell",
      id: "market",
      order: 20,
      bottom: false,
      label: t("插件市场"),
      icon: Plug,
      active: marketOpen,
      hintCmd: "shell.openMarket",
      onSelect: () => onToggleMarket(),
    },
    {
      kind: "shell",
      id: "home",
      order: 30,
      bottom: false,
      label: t("回到首页"),
      icon: Tray,
      hintCmd: "shell.goHome",
      /* 市场覆盖层盖着首页,回首页前先收掉(与原顶栏按钮同语义)。 */
      onSelect: () => {
        if (marketOpen) onToggleMarket();
        toggleHomeSession();
      },
    },
    {
      kind: "shell",
      id: "workspace-switch",
      order: 40,
      bottom: false,
      label: t("切换工作区"),
      icon: FolderOpen,
      /* 菜单开在钮右侧(rail 贴左缘,下拉向右弹);openMenu 自做视口夹取。 */
      onSelect: (rect) => wsMenus.openMenu(rect.right + 8, rect.top),
      /* 右键 = 活动工作区行菜单(顶栏选择器同款,新建文件/文件夹等直达);
       * 无工作区时空操作。 */
      onContextMenu: (_rect, e) => {
        if (wsMenus.active) wsMenus.openRowMenu(wsMenus.active, e.clientX, e.clientY);
      },
    },
  ];

  const entries: LeftEntry[] = [
    ...actions.map(
      (a): LeftEntry => ({
        kind: "action",
        id: a.id,
        order: a.order ?? 0,
        bottom: a.leftRailBottom ?? false,
        action: a,
      }),
    ),
    ...shellEntries,
  ].sort((x, y) => x.order - y.order);
  const topEntries = entries.filter((e) => !e.bottom);
  const bottomEntries = entries.filter((e) => e.bottom);

  const renderEntry = (entry: LeftEntry) => {
    if (entry.kind === "action") {
      const { action } = entry;
      const isActive = action.active?.() ?? false;
      return (
        <button
          key={action.id}
          type="button"
          className={`left-rail-tab${isActive ? " is-active" : ""}`}
          data-action-id={action.id}
          aria-label={t(action.label)}
          aria-pressed={isActive}
          data-hint={t(action.label)}
          data-hint-side="right"
          title=""
          onClick={(e) => {
            /* 浮层类动作锚 rail 钮右缘,向右弹(右 rail 锚的镜像)。 */
            const r = e.currentTarget.getBoundingClientRect();
            action.onSelect(
              { x: r.right + 8, y: r.top },
              { altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey },
            );
          }}
        >
          <DecorIcon id={action.id} Fallback={action.icon} aria-hidden />
        </button>
      );
    }
    const isActive = entry.active ?? false;
    /* 工作区切换是下拉型入口:补 haspopup/expanded(开态随菜单簇 hook)。 */
    const isMenuEntry = entry.id === "workspace-switch";
    return (
      <button
        key={entry.id}
        type="button"
        className={`left-rail-tab${isActive ? " is-active" : ""}`}
        aria-label={entry.label}
        aria-pressed={isActive || undefined}
        aria-haspopup={isMenuEntry ? "menu" : undefined}
        aria-expanded={isMenuEntry ? wsMenus.menuOpen : undefined}
        data-hint={entry.label}
        data-hint-side="right"
        data-hint-cmd={entry.hintCmd}
        title=""
        onClick={(e) => entry.onSelect(e.currentTarget.getBoundingClientRect(), e)}
        onContextMenu={
          entry.onContextMenu
            ? (e) => {
                e.preventDefault();
                entry.onContextMenu?.(e.currentTarget.getBoundingClientRect(), e);
              }
            : undefined
        }
      >
        {/* data-action-id 挂 svg 而非本钮(TopBar 先例):17 键颜色表按元素命中
            (icon-decor.css [data-action-id=x]{color}),挂钮上会把本钮静息色
            --tmd-fg-subtle 级联顶掉;挂 svg 则 currentColor 回落继承钮色。 */}
        <DecorIcon id={entry.id} Fallback={entry.icon} aria-hidden data-action-id={entry.id} />
      </button>
    );
  };

  return (
    <div className="left-rail" role="toolbar" aria-orientation="vertical" aria-label={t("左侧工具栏")}>
      {topEntries.map(renderEntry)}
      <div className="left-rail-spacer" aria-hidden />
      {bottomEntries.map(renderEntry)}
      {/* 设置菜单触发钮(原侧栏底栏 logo 入口,2026-10-04 用户口径迁最左底;
          菜单本体仍由 SidebarSettingsCluster 渲染,开合态受控提升 AppShell,
          弹层锚左下簇、视觉紧邻本钮)。 */}
      <button
        type="button"
        className={`left-rail-tab left-rail-settings${settingsOpen ? " is-active" : ""}`}
        aria-label={t("设置")}
        aria-haspopup="menu"
        aria-expanded={settingsOpen}
        data-hint={t("设置")}
        data-hint-cmd="shell.openSettings"
        data-hint-side="right"
        data-settings-trigger=""
        title=""
        onClick={onToggleSettings}
      >
        <img src={logoUrl} alt="" className="settings-logo" />
      </button>
      {wsMenus.menus}
    </div>
  );
}

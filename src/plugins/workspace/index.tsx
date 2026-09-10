/**
 * workspace 插件 —— 左侧面板唯一区块:工作区即会话容器。
 * 外观与交互完全复刻 codemoss(WorkspaceCard/ThreadList/WorkspaceMenuOverlay):
 * - 工作区行:双态文件夹图标(hover 换 chevrons)+ 名称 + Default badge
 *   + hover 显形动作组(切到主区/刷新会话/新建会话菜单),右键同「+」
 * - caption 动作区:折叠/展开全部工作区会话(受控 collapsedMap,卡片行内
 *   toggle 与全局按钮同源)+ 插件贡献位(leftSidebar.workspaceCaption)+ 添加工作区
 * - 会话列表扁平化(2026-09-08):无分组段头,会话行平铺于工作区下,行首供应商
 *   图标区分引擎;状态节点圆点(绿=对话中 / 蓝=完成未读,静止闲置即隐藏)保留
 * - 磁盘历史分页:初始条数 = 显示预算解析配额(见 SessionList);
 *   预算编辑入口由 session-budget 插件经 leftSidebar.workspaceCaption
 *   挂载点贡献,本插件不感知预算 UI(拔出该插件 = 回默认分页)
 * - 新建会话菜单:portal + fixed 定位(点击点夹取),CLI 行 + 行右侧刷新
 * - 数据源:活会话 = 内核 PTY 注册表;历史 = 各 CLI 插件 listSessions
 * 组件实现见同目录:WorkspaceList(分组渲染) / WorkspaceCard / SessionList / SessionMenu / groups(分组语义) / utils。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import type { Plugin } from "@kernel/plugin";
import { Mounts } from "@kernel/Mounts";
import { addWorkspace, useWorkspaces, type Workspace } from "@kernel/workspace";
import { pickDirectory } from "@kernel/ipc";
import { spinRemainder } from "@kernel/spin";
import { updateSettings, useSettingsState } from "@kernel/settings";
import { registerSessionRevealHandler } from "@kernel/sessionReveal";
import { SessionMenuOverlay } from "./SessionMenu";
import { clampMenuPosition } from "./utils";
import { Folders, FolderOpen, FolderSimplePlus, CaretDoubleDown, CaretDoubleUp } from "@phosphor-icons/react";
import { createSessionRevealHandler } from "./revealSession";
import { WorkspaceList } from "./WorkspaceList";
import { useGroupedWorkspaces } from "./groups";
import { WorkspaceGroupsTab } from "./GroupSettingsTab";
import { PinnedSessionsSection } from "./PinnedSessions";
import { RunningZoneSection } from "./RunningZone";

/** ⌘T 桥:新建会话菜单开合态在 WorkspaceSection 组件内,命令却在 activate 期注册 ——
 *  模块级 ref 接收分发器触发(先例:TerminalView findRequestRef)。 */
const openNewSessionMenuRef: { current: (() => void) | null } = { current: null };


/** 添加工作区:系统目录选择器 → kernel 注册;失败 warn 诊断不静默。 */
async function handleAddWorkspace() {
  try {
    const selected = await pickDirectory(t("选择工作区目录"));
    if (typeof selected === "string" && selected) {
      addWorkspace(selected);
    }
  } catch (err) {
    // 权限被拒/插件未注册等不再静默,方便定位
    console.warn("workspace: 选择目录失败", err);
  }
}

function WorkspaceSection() {
  useHost();
  /* 顶栏 tab「定位」:消费 kernel/sessionReveal 请求,展开并滚动到该会话行(见 revealSession.ts)。 */
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const reveal = createSessionRevealHandler(sidebarRef);
    const unregister = registerSessionRevealHandler(reveal);
    return () => {
      unregister();
      reveal.cancel();
    };
  }, []);
  const { list, activeId } = useWorkspaces();
  const [menu, setMenu] = useState<{
    workspace: Workspace;
    x: number;
    y: number;
  } | null>(null);
  /** 行内别名重命名中的工作区 id(单例:同时至多一行在改)。 */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [refreshTicks, setRefreshTicks] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  /** 各 key 转圈起始时刻:scanDone 兜底转满一圈(kernel/spin),数据再快也不闪断。 */
  const spinStartRef = useRef<Record<string, number>>({});
  /** 各工作区折叠态(持久化):读写全局 settings.workspaceCollapsedMap,重启恢复。 */
  const { settings } = useSettingsState();
  const collapsedMap = settings.workspaceCollapsedMap;
  /** 会话视图:默认(隐藏归档)/ 归档(只看归档),持久化。 */
  const archivedView = settings.workspaceArchiveView;
  const isCollapsed = (id: string) => collapsedMap[id] ?? true;
  const allCollapsed = list.length > 0 && list.every((ws) => isCollapsed(ws.id));
  const setAllCollapsed = (v: boolean) =>
    updateSettings({
      workspaceCollapsedMap: Object.fromEntries(list.map((ws) => [ws.id, v])),
    });
  const setCollapsed = (id: string, v: boolean) =>
    updateSettings({
      workspaceCollapsedMap: { ...collapsedMap, [id]: v },
    });
  /** 组头折叠态(持久化):缺失 = 展开;组定义/派生见 ./groups。 */
  const groupCollapsedMap = settings.workspaceGroupCollapsedMap;
  const grouped = useGroupedWorkspaces();
  const toggleGroup = (id: string) =>
    updateSettings({
      workspaceGroupCollapsedMap: { ...groupCollapsedMap, [id]: !groupCollapsedMap[id] },
    });
  /** ⌘T 入口:无点击锚点,菜单开在左栏顶部;工作区取活动者,缺省首个,皆无则不动。
   *  useCallback 钉住引用:下方 ref 同步 effect 以它为依赖,每轮重建会反复重同步。 */
  const openMenu = useCallback(() => {
    const ws = list.find((w) => w.id === activeId) ?? list[0];
    if (!ws) return;
    setMenu({ workspace: ws, ...clampMenuPosition(16, 60) });
  }, [list, activeId]);

  /* 开函数引用稳定(仅 list/activeId 变化才重建),效果依其重同步 ref;
   * 卸载置空(插件拔出后 ⌘T 成 no-op)。 */
  useEffect(() => {
    openNewSessionMenuRef.current = openMenu;
    return () => {
      openNewSessionMenuRef.current = null;
    };
  }, [openMenu]);

  /** 刷新键 = 工作区:CLI —— tick 触发重扫,scanDone 清 spin。 */
  const bumpTick = (workspaceId: string, profileId: string) => {
    const key = `${workspaceId}:${profileId}`;
    spinStartRef.current[key] = Date.now();
    setRefreshing((prev) => ({ ...prev, [key]: true }));
    setRefreshTicks((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  };

  const scanDone = (workspaceId: string, profileId: string) => {
    const key = `${workspaceId}:${profileId}`;
    const clear = () => setRefreshing((prev) => ({ ...prev, [key]: false }));
    const wait = spinRemainder(spinStartRef.current[key] ?? 0);
    if (wait > 0) setTimeout(clear, wait);
    else clear();
  };

  return (
    <div className="ws-sidebar" ref={sidebarRef}>
      {/* 全局置顶区(codemoss Pinned 复刻):scope=global 的会话跨工作区汇总于此 */}
      <PinnedSessionsSection />

      {/* 运行区:运行中/结束未查看的活会话自动聚集,已查看自动回组(单一区域原则,见 RunningZone.tsx) */}
      <RunningZoneSection />

      <div className="ws-caption">
        <span className="ws-caption-label">
          <Folders size="0.6875rem" aria-hidden className="ws-caption-icon" />
          {t("工作区")}
        </span>
        <span className="ws-caption-actions">
          {/* 会话视图切换:默认/归档;workspace 插件内各分组经 settings 响应式过滤 */}
          <div className="ws-view-toggle" role="radiogroup" aria-label={t("会话视图")}>
            <button
              type="button"
              role="radio"
              aria-checked={!archivedView}
              className={!archivedView ? "is-on" : ""}
              onClick={() => updateSettings({ workspaceArchiveView: false })}
            >
              {t("默认")}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={archivedView}
              className={archivedView ? "is-on" : ""}
              onClick={() => updateSettings({ workspaceArchiveView: true })}
            >
              {t("归档")}
            </button>
          </div>
          <button
            className="ws-caption-btn"
            title={allCollapsed ? t("展开全部工作区会话") : t("折叠全部工作区会话")}
            aria-label={allCollapsed ? t("展开全部工作区会话") : t("折叠全部工作区会话")}
            onClick={() => setAllCollapsed(!allCollapsed)}
          >
            {allCollapsed ? (
              <CaretDoubleUp size="0.8125rem" aria-hidden />
            ) : (
              <CaretDoubleDown size="0.8125rem" aria-hidden />
            )}
          </button>
          {/* 插件贡献的动作位(如 session-budget 的预算入口),渲染器 = kernel Mounts */}
          <Mounts point="leftSidebar.workspaceCaption" />
          <button
            className="ws-caption-btn"
            title={t("添加工作区")}
            onClick={() => void handleAddWorkspace()}
          >
            <FolderSimplePlus size="0.8125rem" aria-hidden />
          </button>
        </span>
      </div>

      {/* 分组渲染(参考 codemoss):未分组无头置顶 + 命名组头折叠;实现见 WorkspaceList。 */}
      <WorkspaceList
        grouped={grouped}
        groupCollapsedMap={groupCollapsedMap}
        onToggleGroup={toggleGroup}
        activeId={activeId}
        isCollapsed={isCollapsed}
        onToggleCollapsed={(id) => setCollapsed(id, !isCollapsed(id))}
        renamingId={renamingId}
        onRenameEnd={() => setRenamingId(null)}
        refreshTicks={refreshTicks}
        refreshing={refreshing}
        onRefreshWorkspace={(wsId) =>
          host.getCliProfiles().forEach((p) => {
            /* 无 listSessions 的 profile 没有扫描完成回调,跳过以免刷新按钮永远转圈 */
            if (p.listSessions) bumpTick(wsId, p.id);
          })
        }
        onScanDone={scanDone}
        onShowMenu={(workspace, x, y) =>
          setMenu({ workspace, ...clampMenuPosition(x, y) })
        }
      />

      {menu && (
        <SessionMenuOverlay
          workspace={menu.workspace}
          canRemove={list.length > 1}
          position={{ x: menu.x, y: menu.y }}
          refreshing={Object.fromEntries(
            host
              .getCliProfiles()
              .map((p) => [p.id, refreshing[`${menu.workspace.id}:${p.id}`] ?? false]),
          )}
          onRefresh={(profileId) => bumpTick(menu.workspace.id, profileId)}
          onRename={() => {
            setRenamingId(menu.workspace.id);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export const workspacePlugin: Plugin = {
  id: "workspace",
  meta: {
    name: t("工作区"),
    abbr: "WK",
    desc: t("左侧栏工作区/会话列表与菜单"),
    icon: FolderOpen,
    iconColor: "#5B8BE8",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("leftSidebar.section", {
      order: 0,
      component: WorkspaceSection,
    });
    /* ⌘T 打开新建会话菜单:开合态经模块级 ref 桥进组件(见文件头)。 */
    ctx.registerCommand({
      id: "workspace.newSessionMenu",
      title: t("打开新建会话菜单"),
      keybinding: "Cmd+T",
      run: () => openNewSessionMenuRef.current?.(),
    });
    /* 「工作区分组」设置 section:组 CRUD 管理入口(语义在 ./groups)。 */
    ctx.registerSettingsSection({
      id: "workspace-groups",
      title: t("工作区分组"),
      description: t("组织左侧栏工作区的分组:新建、重命名、排序与删除。"),
      icon: <Folders size="0.875rem" aria-hidden />,
      order: 12,
      tabs: [
        {
          id: "groups",
          title: t("分组管理"),
          icon: <Folders size="0.875rem" aria-hidden />,
          order: 0,
          component: WorkspaceGroupsTab,
        },
      ],
    });
  },
};

/**
 * workspace 插件 —— 左侧面板唯一区块:工作区即会话容器。
 * 外观与交互完全复刻 codemoss(WorkspaceCard/ThreadList/WorkspaceMenuOverlay):
 * - 工作区行:双态文件夹图标(hover 换 chevrons)+ 名称 + Default badge
 *   + hover 显形动作组(切到主区/刷新会话/新建会话菜单),右键同「+」
 * - 会话树:贯穿竖线 + ╰ 弯钩;行 = CLI EngineIcon + 名称 + meta
 *   (活会话 meta 显示呼吸灯,磁盘会话显示相对时间),固定在 CLI 分组内
 * - 磁盘历史分页:初始 10 条,"更多..."翻倍递增(10 → 20 → 40 → 80)
 * - 新建会话菜单:portal + fixed 定位(点击点夹取),CLI 行 + 行右侧刷新
 * - 数据源:活会话 = 内核 PTY 注册表;历史 = 各 CLI 插件 listSessions
 * 组件实现见同目录:WorkspaceCard / SessionList / SessionMenu / utils。
 */

import { useState } from "react";
import { host, useHost } from "@kernel/host";
import type { Plugin } from "@kernel/plugin";
import {
  addWorkspace,
  useWorkspaces,
  type Workspace,
} from "@kernel/workspace";
import { pickDirectory } from "@kernel/ipc";
import { FolderPlus } from "lucide-react";
import { SessionMenuOverlay, clampMenuPosition } from "./SessionMenu";
import { WorkspaceCard } from "./WorkspaceCard";

function WorkspaceSection() {
  useHost();
  const { list, activeId } = useWorkspaces();
  const [menu, setMenu] = useState<{
    workspace: Workspace;
    x: number;
    y: number;
  } | null>(null);
  const [refreshTicks, setRefreshTicks] = useState<Record<string, number>>({});
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});

  async function handleAdd() {
    try {
      const selected = await pickDirectory("选择工作区目录");
      if (typeof selected === "string" && selected) {
        addWorkspace(selected);
      }
    } catch (err) {
      // 权限被拒/插件未注册等不再静默,方便定位
      console.warn("workspace: 选择目录失败", err);
    }
  }

  /** 刷新键 = 工作区:CLI —— tick 触发重扫,scanDone 清 spin。 */
  const bumpTick = (workspaceId: string, profileId: string) => {
    const key = `${workspaceId}:${profileId}`;
    setRefreshing((prev) => ({ ...prev, [key]: true }));
    setRefreshTicks((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  };

  const scanDone = (workspaceId: string, profileId: string) => {
    const key = `${workspaceId}:${profileId}`;
    setRefreshing((prev) => ({ ...prev, [key]: false }));
  };

  return (
    <div className="ws-sidebar">
      <div className="ws-caption">
        <span>工作区</span>
        <button
          className="ws-caption-btn"
          title="添加工作区"
          onClick={() => void handleAdd()}
        >
          <FolderPlus size={13} aria-hidden />
        </button>
      </div>

      {list.map((ws) => (
        <WorkspaceCard
          key={ws.id}
          workspace={ws}
          isActive={ws.id === activeId}
          refreshTicks={refreshTicks}
          onRefreshWorkspace={(wsId) =>
            host.getCliProfiles().forEach((p) => bumpTick(wsId, p.id))
          }
          onScanDone={scanDone}
          onShowMenu={(workspace, x, y) =>
            setMenu({ workspace, ...clampMenuPosition(x, y) })
          }
        />
      ))}

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
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

export const workspacePlugin: Plugin = {
  id: "workspace",
  meta: { name: "工作区", abbr: "WK", desc: "左侧栏工作区/会话列表与菜单" },
  activate(ctx) {
    ctx.contribute("leftSidebar.section", {
      order: 0,
      component: WorkspaceSection,
    });
  },
};

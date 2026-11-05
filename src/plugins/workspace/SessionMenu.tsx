/**
 * 新建会话下拉菜单(codemoss SidebarWorkspaceMenuOverlay 复刻):
 * portal + fixed 定位;CLI 行(icon + 名称 + 行右侧刷新);底部工作区操作组。
 *
 * 视觉结构(2026-11-06 分块重构,用户反馈「内部信息分块不清晰」):
 * 每个信息域 = 独立小节块(.wsmenu-section:微升底 + 发丝边框 + 圆角,
 * 与弹窗底色形成明确分块),节头 = 图标 + 标题,说明文案收敛为节内副文本
 * (原散落的 group-title/note/divider 三件套退役,本菜单专用 is-sectioned
 * 修饰,不动 wsmenu 共享类 —— 右键菜单等其他消费方视觉不受影响)。
 * 弹窗头 = 标题 + 右侧工作区名(faint,上下文确认)。
 */

import { createPortal } from "react-dom";
import { useEscClose } from "@kernel/DialogShell";
import { host, useHost } from "@kernel/host";
import { KernelTopics } from "@kernel/events";
import { t } from "@kernel/i18n";
import { Mounts } from "@kernel/Mounts";
import { removeWorkspace, type Workspace } from "@kernel/workspace";
import { findWorkspaceOrigin } from "@kernel/workspaceOrigins";
import { useSettingsState } from "@kernel/settings";
import { assignToGroup } from "./groups";
import {
  ArrowClockwise,
  Check,
  Chats,
  Folders,
  GitBranch,
  Globe,
  PencilSimple,
  RocketLaunch,
  Terminal,
  Trash,
  Wrench,
} from "@phosphor-icons/react";


/* 菜单定位夹取函数 clampMenuPosition 已迁至 ./utils(only-export-components:
 * 组件文件只导出组件),消费方:index.tsx / SessionContextMenu.tsx。 */

/** 小节块节头:图标 + 标题(分块视觉锚点,2026-11-06 视觉重构)。 */
function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="wsmenu-section-head">
      <span className="wsmenu-section-icon" aria-hidden>{icon}</span>
      <span className="wsmenu-section-title">{title}</span>
    </div>
  );
}

export function SessionMenuOverlay({
  workspace,
  canRemove,
  position,
  refreshing,
  onRefresh,
  onRename,
  onWorktree,
  onClose,
}: {
  workspace: Workspace;
  canRemove: boolean;
  position: { x: number; y: number };
  refreshing: Record<string, boolean>;
  onRefresh: (profileId: string) => void;
  onRename: () => void;
  /** 「在新 worktree 中起会话…」:弹层归调用方持有(菜单卸载不连带杀弹层)。 */
  onWorktree: () => void;
  onClose: () => void;
}) {
  const profiles = host.getCliProfiles();

  useEscClose(onClose);
  const { settings } = useSettingsState();
  const groups = settings.workspaceGroups;
  const currentGroupId = groups.some((g) => g.id === workspace.groupId) ? workspace.groupId! : null;
  /* 来源工作区(如远程 WSL)的引擎行过滤/提示/启动适配由来源插件贡献
     (workspaceOrigins 协议);未注册来源 = 全量引擎行 + 默认本地 spawn。 */
  const origin = findWorkspaceOrigin(workspace);
  const cliProfiles = origin?.filterCliProfiles?.(workspace, profiles) ?? profiles;
  const menuNote = origin?.sessionMenuNote?.(workspace) ?? null;
  /* F-01 远程来源组头显隐:挂载点有贡献才渲染组头(组头不空挂)。 */
  useHost();
  const hasRemoteEntries = host.getMount("workspace.newSessionMenu").length > 0;
  /* 「带渲染的会话」组(RPC 结构化会话,structured-session 贡献):同上空挂纪律。 */
  const hasRenderedEntries = host.getMount("workspace.newSessionMenu.rendered").length > 0;
  /* 「远程与其他」组:远程来源贡献(SSH…)或本地 worktree 行存在即显。 */
  const showRemoteGroup = !origin || hasRemoteEntries;

  return createPortal(
    <>
      {/* 透明背板:纯点外关闭,role=presentation 豁免静态元素交互规则 */}
      <div className="wsmenu-backdrop" role="presentation" onClick={onClose} />
      <div className="wsmenu is-sectioned" data-icon-decor="menu" style={{ left: position.x, top: position.y }}>
        {/* 弹窗头:标题 + 右侧工作区名(上下文确认,分块重构 2026-11-06)。 */}
        <div className="wsmenu-head">
          <RocketLaunch size="0.875rem" className="wsmenu-head-icon" aria-hidden />
          <span className="wsmenu-head-title">{origin?.newSessionLabel?.(workspace) ?? t("新建会话")}</span>
          <span className="wsmenu-head-ws" title={workspace.root}>{workspace.name}</span>
        </div>
        {menuNote && <div className="wsmenu-note">{menuNote}</div>}

        {/* PTY 会话块:三列网格压高度(10 引擎 4 行);刷新钮收格内右上角,
            hover 显形。「本地终端」说明仅本地工作区渲染——来源工作区(WSL)
            引擎行经 origin 适配落地,行首来源标签已承担区分语义。 */}
        <section className="wsmenu-section">
          <SectionHead icon={<Terminal size="0.75rem" />} title={t("PTY 会话")} />
          {!origin && <div className="wsmenu-section-desc">{t("本地终端,按 CLI 原生交互")}</div>}
          <div className="wsmenu-grid">
            {cliProfiles.map((p) => (
              <div className="wsmenu-cell" key={p.id}>
                <button
                  className="wsmenu-item"
                  onClick={() => {
                    /* 来源适配(远程 WSL:SSH 包装会话 + 引擎档案透传)优先接管;
                       spawn 被拒的原因已由内核广播 sessionStartFailed(toast),此处吞 rejection。 */
                    if (origin?.spawnCliSession?.(workspace, p)) {
                      onClose();
                      return;
                    }
                    host.events.emit(KernelTopics.sessionViewRequested, null);
                    host.createSession(p.id, workspace.root, workspace.id).catch(() => undefined);
                    onClose();
                  }}
                >
                  <span className="wsmenu-item-icon">{p.renderIcon?.(14)}</span>
                  <span className="wsmenu-item-label">{p.name}</span>
                </button>
                <button
                  className={`wsmenu-item-refresh${refreshing[p.id] ? " is-refreshing" : ""}`}
                  title={t("刷新 {profile} 会话列表", { profile: p.name })}
                  onClick={() => onRefresh(p.id)}
                >
                  <ArrowClockwise />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* 带渲染的会话块(RPC 结构化会话,structured-session 贡献):节头 + 说明
            承担「带渲染」语义,行内只列引擎名;块随注册表出现/消失(插件禁用即退场)。 */}
        {hasRenderedEntries && (
          <section className="wsmenu-section">
            <SectionHead icon={<Chats size="0.75rem" />} title={t("带渲染的会话")} />
            <div className="wsmenu-section-desc">{t("思考与工具调用以卡片渲染,过程实时可见")}</div>
            <Mounts point="workspace.newSessionMenu.rendered" props={{ onClose }} />
          </section>
        )}

        {/* 远程与其他块:SSH 连接等插件贡献的远程入口 + 本地「在新 worktree 中起会话」;
            WSL 走来源工作区的 origin 适配(标题/引擎行/note),不在此重复放行。 */}
        {showRemoteGroup && (
          <section className="wsmenu-section">
            <SectionHead icon={<Globe size="0.75rem" />} title={t("远程与其他")} />
            <Mounts point="workspace.newSessionMenu" props={{ onClose }} />
            {/* 新 worktree 会话:仅本地工作区。建树链 = 本地 git + 本地 PTY spawn,对
                来源工作区(WSL/SSH)语义错误;来源的新会话引擎行已由 origin 接管,
                这里不放绕过通道。非 git 仓在弹层内如实报错(本地空工作区可达,发现性优先)。 */}
            {!origin && (
              <button
                className="wsmenu-item"
                onClick={() => {
                  onClose();
                  onWorktree();
                }}
              >
                <span className="wsmenu-item-icon">
                  <GitBranch size="0.8125rem" />
                </span>
                <span className="wsmenu-item-label">{t("在新 worktree 中起会话…")}</span>
              </button>
            )}
          </section>
        )}

        {/* 移动到组块(codemoss assign-workspace-group 同款):仅存在组时出现,当前组打勾。 */}
        {groups.length > 0 && (
          <section className="wsmenu-section">
            <SectionHead icon={<Folders size="0.75rem" />} title={t("移动到组")} />
            {[{ id: null, name: t("未分组") }, ...groups].map((g) => (
              <button
                key={g.id ?? "ungrouped"}
                className="wsmenu-item"
                onClick={() => {
                  assignToGroup(workspace.id, g.id);
                  onClose();
                }}
              >
                <span className="wsmenu-item-icon">
                  {currentGroupId === (g.id ?? null) && <Check size="0.8125rem" />}
                </span>
                <span className="wsmenu-item-label">{g.name}</span>
              </button>
            ))}
          </section>
        )}

        {/* 工作区操作块:两项并排行,再省一行高度;canRemove=false 时设置别名独占整行。 */}
        <section className="wsmenu-section">
          <SectionHead icon={<Wrench size="0.75rem" />} title={t("工作区操作")} />
          <div className="wsmenu-ops">
            <button
              className="wsmenu-item"
              onClick={onRename}
            >
              <span className="wsmenu-item-icon">
                <PencilSimple size="0.8125rem" />
              </span>
              <span className="wsmenu-item-label">{t("设置别名")}</span>
            </button>
            {canRemove && (
              <button
                className="wsmenu-item is-danger"
                onClick={() => {
                  removeWorkspace(workspace.id);
                  onClose();
                }}
              >
                <span className="wsmenu-item-icon">
                  <Trash size="0.8125rem" data-icon-keep />
                </span>
                <span className="wsmenu-item-label">{t("删除工作区")}</span>
              </button>
            )}
          </div>
        </section>
      </div>
    </>,
    document.body,
  );
}

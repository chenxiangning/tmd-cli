/**
 * 会话标题 tab 条 —— 顶栏中央同时展示最多 4 个打开的会话(容量见 kernel/sessionTabs)。
 *
 * 数据:kernel/sessionTabs MRU(纯事件驱动,打开次序稳定)+ host 活跃指针 +
 * 交互:点击切会话;× = 摘 tab 不杀会话(PTY 继续跑,侧栏仍在,见 store 契约);
 * 行内扎点 = 置顶到全局/取消(与侧栏 PinToggle 同语义,覆盖层未落盘禁用);
 * 定位 = 展开左栏并滚动到该会话行(kernel/sessionReveal 桥 → workspace 插件消费)。
 * 右键菜单:重命名(行内输入,同侧栏契约;未落盘禁用)/ 关闭 / 关闭其他 / 关闭全部
 * (TabContextMenu,与文件 tab 同一套 icon)。未读(完成未查看)会话缀主题色圆点。
 * tab 前置引擎品牌 logo(host.getCliProfile().renderIcon,与侧栏分组段头同源)。
 * 设计取舍见 docs/superpowers/specs/2026-09-03-session-title-tabs-design.md。
 */

import { memo, useState } from "react";
import { Cross, CrosshairSimple } from "@phosphor-icons/react";
import { PinIcon } from "@kernel/PinIcon";
import { isSessionPinned, pinSession, sessionPinKey, unpinSession } from "@kernel/sessionPins";
import { requestSessionReveal } from "@kernel/sessionReveal";
import { shellLeftEnsureOpen } from "./shortcutCommands";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { RenameInput, type RenameTarget } from "@kernel/RenameInput";
import { useSettingsState } from "@kernel/settings";
import {
  closeAllSessionTabs,
  closeOtherSessionTabs,
  closeSessionTab,
  getSessionTabTitle,
  useSessionTabs,
} from "@kernel/sessionTabs";
import { sessionTitleKey, setSessionTitle, shortId } from "@kernel/sessionTitles";
import { TabContextMenu } from "./TabContextMenu";

function SessionTabBarImpl() {
  useHost(); /* 活跃指针 / 会话存活 / 身份绑定 / 未读标记变化 */
  const { settings } = useSettingsState(); /* 开关 + 手动命名覆盖层 */
  const { ids } = useSessionTabs();
  /** 右键菜单目标:null 关闭。 */
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /** 行内重命名目标:tmd 会话 id + 磁盘身份 key(重命名态替换 tab 标签为输入框)。 */
  const [renaming, setRenaming] = useState<{ id: string; target: RenameTarget } | null>(null);

  /** 标题解析:手动命名 > 打开快照 > meta 标题 > 短码(与渲染优先级同源)。 */
  const resolveTitle = (id: string): string | undefined => {
    const meta = host.getSessions().find((s) => s.id === id);
    if (!meta) return undefined;
    const cliSessionId = host.getCliSessionId(id);
    return (
      (cliSessionId
        ? settings.sessionTitles[sessionTitleKey(meta.profileId, cliSessionId)]
        : undefined) ??
      getSessionTabTitle(id) ??
      meta.title ??
      shortId(meta.id)
    );
  };

  /** 重命名提交:null=取消;空串=清除命名回归默认标题。会话中途退出则丢弃。 */
  const commitRename = (value: string | null) => {
    if (renaming && value !== null) {
      const alive = host.getSessions().some((s) => s.id === renaming.id);
      if (alive) {
        setSessionTitle(
          renaming.target.profileId,
          renaming.target.cliSessionId,
          value,
        );
      }
    }
    setRenaming(null);
  };

  if (!settings.sessionTabsEnabled || ids.length === 0) return null;

  return (
    <div className="session-tabs" role="tablist" aria-label={t("打开的会话")}>
      {ids.map((id) => {
        const meta = host.getSessions().find((s) => s.id === id);
        /* 剪除事件竞态期的防御兜底:sessionsChanged 广播前先卸载消失 tab */
        if (!meta) return null;
        const title = resolveTitle(id) ?? shortId(meta.id);
        const active = host.getActiveSessionId() === id;
        const cliSessionId = host.getCliSessionId(id);
        const pinKey =
          cliSessionId !== undefined && meta.workspaceId
            ? sessionPinKey(meta.workspaceId, meta.profileId, cliSessionId)
            : undefined;
        const pinned = pinKey !== undefined && isSessionPinned(pinKey);
        return (
          <div
            key={id}
            className={`session-tab${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id });
            }}
          >
            {renaming?.id === id ? (
              <RenameInput
                className="session-tab-rename-input"
                target={renaming.target}
                onCommit={commitRename}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="session-tab-switch"
                  title={host.isWaitingConfirm(id) ? t("{title} · 等待确认", { title }) : title}
                  onClick={() => host.setActiveSession(id)}
                >
                  {host.getCliProfile(meta.profileId)?.renderIcon?.(12)}
                  {host.isWaitingConfirm(id) ? (
                    <span className="session-tab-dot is-ask" aria-hidden />
                  ) : host.isUnread(id) ? (
                    <span className="session-tab-dot" aria-hidden />
                  ) : null}
                  <span className="session-tab-label">{title}</span>
                </button>
                <button
                  type="button"
                  className={`session-tab-pin${pinned ? " is-on" : ""}`}
                  aria-label={t(pinned ? "取消置顶" : "置顶到全局")}
                  title={t(pinned ? "取消置顶" : "置顶到全局")}
                  onClick={() => {
                    if (!pinKey || cliSessionId === undefined) return;
                    if (pinned) unpinSession(pinKey);
                    else pinSession(pinKey, "global", title !== shortId(cliSessionId) ? title : undefined);
                  }}
                >
                  <PinIcon size="0.6875rem" />
                </button>
                <button
                  type="button"
                  className="session-tab-locate"
                  aria-label={t("在左侧栏定位会话")}
                  title={t("在左侧栏定位会话")}
                  onClick={() => {
                    shellLeftEnsureOpen.current?.();
                    requestSessionReveal(id);
                  }}
                >
                  <CrosshairSimple size="0.6875rem" aria-hidden />
                </button>
                <button
                  type="button"
                  className="session-tab-remove"
                  aria-label={t("从标签条移除:{title}", { title })}
                  title={t("从标签条移除(会话保持运行)")}
                  onClick={() => closeSessionTab(id)}
                >
                  <Cross size="0.625rem" aria-hidden />
                </button>
              </>
            )}
          </div>
        );
      })}
      {menu ? (
        <TabContextMenu
          position={{ x: menu.x, y: menu.y }}
          canRename={host.getCliSessionId(menu.id) !== null}
          onRename={() => {
            const meta = host.getSessions().find((s) => s.id === menu.id);
            const cliSessionId = host.getCliSessionId(menu.id);
            /* 菜单存活期会话可能已退出/落盘身份未绑定:双重防御,不进入重命名态 */
            if (!meta || !cliSessionId) return;
            setRenaming({
              id: menu.id,
              target: {
                profileId: meta.profileId,
                cliSessionId,
                current: resolveTitle(menu.id) ?? "",
              },
            });
          }}
          onCloseTab={() => closeSessionTab(menu.id)}
          onCloseOthers={() => closeOtherSessionTabs(menu.id)}
          onCloseAll={() => closeAllSessionTabs()}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  );
}

export const SessionTabBar = memo(SessionTabBarImpl);

/**
 * 会话标题 tab 条 —— 顶栏中央同时展示最多 4 个打开的会话(容量见 kernel/sessionTabs)。
 *
 * 数据:kernel/sessionTabs MRU(纯事件驱动,打开次序稳定)+ host 活跃指针 +
 * settings 命名覆盖层。标题优先级:手动命名 > 打开时快照 > 短码,改名即时生效。
 * 交互:点击切会话;× = 摘 tab 不杀会话(PTY 继续跑,侧栏仍在,见 store 契约);
 * 右键菜单:重命名(行内输入,同侧栏契约;未落盘禁用)/ 关闭 / 关闭其他 / 关闭全部
 * (TabContextMenu,与文件 tab 同一套 icon)。未读(完成未查看)会话缀主题色圆点。
 * 设计取舍见 docs/superpowers/specs/2026-09-03-session-title-tabs-design.md。
 */

import { memo, useState } from "react";
import { Cross } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
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
    <div className="session-tabs" role="tablist" aria-label="打开的会话">
      {ids.map((id) => {
        const meta = host.getSessions().find((s) => s.id === id);
        /* 剪除事件竞态期的防御兜底:sessionsChanged 广播前先卸载消失 tab */
        if (!meta) return null;
        const title = resolveTitle(id) ?? shortId(meta.id);
        const active = host.getActiveSessionId() === id;
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
                  title={
                    host.isWaitingConfirm(id) ? `${title} · 等待确认` : title
                  }
                  onClick={() => host.setActiveSession(id)}
                >
                  {host.isWaitingConfirm(id) ? (
                    <span className="session-tab-dot is-ask" aria-hidden />
                  ) : host.isUnread(id) ? (
                    <span className="session-tab-dot" aria-hidden />
                  ) : null}
                  <span className="session-tab-label">{title}</span>
                </button>
                <button
                  type="button"
                  className="session-tab-remove"
                  aria-label={`从标签条移除:${title}`}
                  title="从标签条移除(会话保持运行)"
                  onClick={() => closeSessionTab(id)}
                >
                  <Cross size={10} aria-hidden />
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

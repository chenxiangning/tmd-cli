/**
 * 会话标题 tab 条 —— 顶栏中央同时展示最多 4 个打开的会话(容量见 kernel/sessionTabs)。
 *
 * 数据:kernel/sessionTabs MRU(纯事件驱动,打开次序稳定)+ host 活跃指针 +
 * settings 命名覆盖层。标题优先级:手动命名 > 打开时快照 > 短码,改名即时生效。
 * 交互:点击切会话;× = 摘 tab 不杀会话(PTY 继续跑,侧栏仍在,见 store 契约)。
 * 未读(完成未查看)会话缀主题色圆点。设计取舍见
 * docs/superpowers/specs/2026-09-03-session-title-tabs-design.md。
 */

import { memo } from "react";
import { X } from "lucide-react";
import { host, useHost } from "@kernel/host";
import { useSettingsState } from "@kernel/settings";
import {
  closeSessionTab,
  getSessionTabTitle,
  useSessionTabs,
} from "@kernel/sessionTabs";
import { sessionTitleKey, shortId } from "@kernel/sessionTitles";

function SessionTabBarImpl() {
  useHost(); /* 活跃指针 / 会话存活 / 身份绑定 / 未读标记变化 */
  const { settings } = useSettingsState(); /* 开关 + 手动命名覆盖层 */
  const { ids } = useSessionTabs();

  if (!settings.sessionTabsEnabled || ids.length === 0) return null;

  return (
    <div className="session-tabs" role="tablist" aria-label="打开的会话">
      {ids.map((id) => {
        const meta = host.getSessions().find((s) => s.id === id);
        /* 剪除事件竞态期的防御兜底:sessionsChanged 广播前先卸载消失 tab */
        if (!meta) return null;
        const cliSessionId = host.getCliSessionId(id);
        const title =
          (cliSessionId
            ? settings.sessionTitles[sessionTitleKey(meta.profileId, cliSessionId)]
            : undefined) ??
          getSessionTabTitle(id) ??
          meta.title ??
          shortId(meta.id);
        const active = host.getActiveSessionId() === id;
        return (
          <div
            key={id}
            className={`session-tab${active ? " is-active" : ""}`}
            role="tab"
            aria-selected={active}
          >
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
              <X size={10} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export const SessionTabBar = memo(SessionTabBarImpl);

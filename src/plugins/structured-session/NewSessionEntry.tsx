/**
 * NewSessionEntry —— 新建会话菜单「带渲染的会话」组入口
 * (workspace.newSessionMenu.rendered 挂载;2026-11-05 自原「更多来源」组拆出)。
 * 只列声明 structuredRpc 的引擎(omp/pi),无能力引擎渲染 null(菜单无死入口);
 * 「重开上次会话」(批次 4)置顶:tmd.ss.last 有记忆的引擎出续聊项,
 * 点击带 resumeSessionId 开 tab(--resume 换壳 + 磁盘种子补历史);
 * 行文案 = 引擎名(组头 + 组说明已承担「带渲染」语义,行内不再重复);
 * 幕布会话的模式切换。
 */

import { ArrowCounterClockwise, Chats } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { openStructuredSessionTab, readLastSsSession } from "@kernel/structuredSessionTabs";
import { getActiveWorkspace } from "@kernel/workspace";

export function NewSessionEntry({ onClose }: { onClose?: () => void }) {
  useHost(); /* profile 注册面变化(插件启停)重渲 */
  const capable = host.getCliProfiles().filter((p) => p.structuredRpc);
  if (capable.length === 0) return null;
  /* 「重开上次」(批次 4):tmd.ss.last 有记忆的引擎才出;cwd = 当前工作区根。
   * 多引擎都有记忆时逐引擎一行(与新建项同形,虚线区分「续」而非「新」)。 */
  const root = getActiveWorkspace()?.root;
  const resumable = root
    ? capable.flatMap((p) => {
        const sid = readLastSsSession(p.id, root);
        return sid && p.structuredRpc?.resumeArgs ? [{ profile: p, sid }] : [];
      })
    : [];
  return (
    <>
      {resumable.map(({ profile, sid }) => (
        <button
          key={`resume-${profile.id}`}
          type="button"
          className="wsmenu-item ss-menu-resume"
          onClick={() => {
            openStructuredSessionTab(profile.id, root, { resumeSessionId: sid });
            onClose?.();
          }}
        >
          <span className="wsmenu-item-icon">
            <ArrowCounterClockwise size="0.875rem" />
          </span>
          <span className="wsmenu-item-label">{`${profile.name} · ${t("重开上次会话")}`}</span>
        </button>
      ))}
      {capable.map((p) => (
        <button
          key={p.id}
          type="button"
          className="wsmenu-item"
          onClick={() => {
            openStructuredSessionTab(p.id);
            onClose?.();
          }}
        >
          <span className="wsmenu-item-icon">
            {/* 引擎自有 logo(renderIcon),与 PTY 网格同标识;无自定义图标回落 Chats */}
            {p.renderIcon?.(14) ?? <Chats size="0.875rem" />}
          </span>
          <span className="wsmenu-item-label">{p.name}</span>
        </button>
      ))}
    </>
  );
}

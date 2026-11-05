/**
 * NewSessionEntry —— 新建会话菜单「带渲染的会话」组入口
 * (workspace.newSessionMenu.rendered 挂载;2026-11-05 自原「更多来源」组拆出)。
 * 只列声明 structuredRpc 的引擎(omp/pi),无能力引擎渲染 null(菜单无死入口);
 * 行文案 = 引擎名(组头 + 组说明已承担「带渲染」语义,行内不再重复);
 * 幕布会话的模式切换。
 */

import { Chats } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { openStructuredSessionTab } from "@kernel/structuredSessionTabs";

export function NewSessionEntry({ onClose }: { onClose?: () => void }) {
  useHost(); /* profile 注册面变化(插件启停)重渲 */
  const capable = host.getCliProfiles().filter((p) => p.structuredRpc);
  if (capable.length === 0) return null;
  return (
    <>
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

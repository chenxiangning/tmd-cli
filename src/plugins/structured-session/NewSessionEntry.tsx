/**
 * NewSessionEntry —— 新建会话菜单的「RPC 会话」入口(workspace.newSessionMenu 挂载)。
 * G-01:入口自右 rail 迁入新建菜单(与「SSH 连接…」同 mount,宿主侧组头
 * 「更多来源」);只列声明 structuredRpc 的引擎(omp/pi),无能力引擎渲染
 * null(菜单无死入口);点击打开独立 RPC 交互 tab —— 不共享 PTY 的
 * cliSessionId,也不伪装成幕布会话的模式切换。
 */

import { Chats } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { openStructuredSessionTab } from "./tabs";

export function NewSessionEntry() {
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
          onClick={() => openStructuredSessionTab(p.id)}
        >
          <span className="wsmenu-item-icon">
            <Chats size="0.875rem" />
          </span>
          <span className="wsmenu-item-label">{t("{name} RPC 会话", { name: p.name })}</span>
        </button>
      ))}
    </>
  );
}

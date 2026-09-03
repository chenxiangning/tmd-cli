/**
 * MenuEntry —— 新建会话菜单的「SSH 连接」入口(workspace.newSessionMenu 挂载)。
 * 点击打开主机选择 overlay(SshOverlay),由 state.openHostPicker 驱动。
 */

import { Server } from "lucide-react";
import { openHostPicker } from "./state";

export function MenuEntry() {
  return (
    <button
      type="button"
      className="wsmenu-item"
      onClick={() => openHostPicker()}
    >
      <span className="wsmenu-item-icon">
        <Server size={14} />
      </span>
      <span className="wsmenu-item-label">SSH 连接…</span>
    </button>
  );
}

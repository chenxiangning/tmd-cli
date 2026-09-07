/**
 * MenuEntry —— 新建会话菜单的「SSH 连接」入口(workspace.newSessionMenu 挂载)。
 * 点击打开主机选择 overlay(SshOverlay),由 state.openHostPicker 驱动。
 */

import { HardDrive } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { openHostPicker } from "./state";

export function MenuEntry() {
  return (
    <button
      type="button"
      className="wsmenu-item"
      onClick={() => openHostPicker()}
    >
      <span className="wsmenu-item-icon">
        <HardDrive size={14} />
      </span>
      <span className="wsmenu-item-label">{t("SSH 连接…")}</span>
    </button>
  );
}

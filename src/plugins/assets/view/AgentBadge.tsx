/**
 * 智能体徽章 —— composer.statusBar 挂载点贡献:当前会话选中的智能体
 * (icon + 名称 + × 取消);未选中 = 不渲染。选择按 sessionId 持久化在
 * agents.json 的 selectedBySession,发送时经 assetsSendTransform 尾拼角色块。
 */

import { Robot, X } from "@phosphor-icons/react";
import { host, useHost } from "@kernel/host";
import { t } from "@kernel/i18n";
import { selectAgent, useAssets } from "../store";

export function AgentBadge() {
  useHost();
  const assets = useAssets();
  const sid = host.getActiveSessionId();
  const agent = sid
    ? (assets.agents.find((a) => a.id === assets.selectedBySession[sid]) ?? null)
    : null;
  if (!agent || !sid) return null;
  return (
    <span className="assets-agent-badge" title={t("本会话智能体:发送时在消息尾拼角色块")}>
      {agent.icon ? <span aria-hidden>{agent.icon}</span> : <Robot size="0.75rem" aria-hidden />}
      <span className="assets-agent-badge-name">{agent.name}</span>
      <button
        type="button"
        className="assets-agent-badge-clear"
        aria-label={t("取消智能体")}
        onClick={() => void selectAgent(sid, null)}
      >
        <X size="0.625rem" />
      </button>
    </span>
  );
}

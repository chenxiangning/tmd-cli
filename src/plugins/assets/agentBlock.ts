/**
 * 智能体角色块 + 发送变换 —— codemoss 同款的零协议注入:
 * 选中的智能体不进文本框,发送时在用户消息尾部拼一段 markdown 角色块,
 * 任何 CLI 引擎都按普通用户输入吃下(块格式照抄 codemoss,去 icon 行)。
 *
 * 守卫:wire 以 "/" 开头 = 命令形态(手敲 /clear、$skill 经 translate 变 /skill:*),
 * 一律不拼;选中 agent 已被删除 = selectedAgent 返回 null,fail-open 发原文。
 */

import type { ComposerSendTransform } from "@kernel/composerExt";
import { selectedAgent, type Agent } from "./store";

function agentRoleBlock(agent: Agent): string {
  return `\n\n## Agent Role and Instructions\n\nAgent Name: ${agent.name}\n\n${agent.prompt}`;
}

export const assetsSendTransform: ComposerSendTransform = (text, sessionId) => {
  if (!sessionId || text.trimStart().startsWith("/")) return text;
  const agent = selectedAgent(sessionId);
  return agent ? text + agentRoleBlock(agent) : text;
};

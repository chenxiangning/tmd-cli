/**
 * assets 插件 —— 可复用智能体与提示词资产库(对标 codemoss「智能体 / 提示词」,
 * 设计 spec:docs/superpowers/specs/2026-09-08-assistant-assets-design.md)。
 *
 * 注册面:
 * - kernel composerExt:!! 提示词触发源(insertText = 正文)/ ## 智能体触发源
 *   (onPick = 按会话选中)/ assetsSendTransform(发送时尾拼角色块);
 * - composer.inputRail:右缘双唤醒图标;composer.statusBar:选中智能体徽章;
 * - 设置 section「智能体 / 提示词」双 tab:CRUD + codemoss 三源导入。
 *
 * 存储全部走通用 fs_* 原语(~/.tmd-cli/ 平铺),Rust/内核零改动。
 */

import { Quotes, Robot } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { KernelTopics } from "@kernel/events";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import {
  registerComposerSendTransform,
  registerComposerTriggerSource,
} from "@kernel/composerExt";
import { assetsSendTransform } from "./agentBlock";
import { promptContent, promptSuggestions } from "./promptStore";
import {
  agentByName,
  agentSuggestions,
  loadAssets,
  pruneSelectedSessions,
  selectAgent,
} from "./store";
import { AgentBadge } from "./view/AgentBadge";
import { AgentTab } from "./view/AgentTab";
import { PromptTab } from "./view/PromptTab";
import { WakeIcons } from "./view/WakeIcons";

export const assetsPlugin: Plugin = {
  id: "assets",
  meta: {
    name: t("智能体 / 提示词"),
    abbr: "资产",
    desc: t("可复用智能体与提示词资产库(composer !! / ## 消费)"),
    icon: Robot,
    iconColor: "#4EC9B0",
    category: "feature",
  },
  activate(ctx) {
    /* 会话移除(手动关 tab / 进程退出都经 sessionsChanged)→ 剪除选中表死 id;加载后先剪一轮存量 */
    const prune = () => pruneSelectedSessions(new Set(host.getSessions().map((s) => s.id)));
    void loadAssets().then(prune);
    const offs = [
      ctx.events.on(KernelTopics.sessionsChanged, prune),
      registerComposerTriggerSource({
        char: "!!",
        label: t("提示词"),
        list: promptSuggestions,
        insertText: (s, cwd) => promptContent(s.value, cwd),
      }),
      registerComposerTriggerSource({
        char: "##",
        label: t("智能体"),
        list: agentSuggestions,
        onPick: (s, sessionId) => {
          const agent = agentByName(s.value);
          if (sessionId && agent) void selectAgent(sessionId, agent.id);
        },
      }),
      registerComposerSendTransform(assetsSendTransform),
    ];
    /* 反注册钩先设:下方贡献注册中途抛错也不留半注册状态 */
    this.deactivate = () => {
      for (const off of offs) off();
    };
    ctx.contribute("composer.inputRail", { order: 0, component: WakeIcons });
    ctx.contribute("composer.statusBar", { order: 20, component: AgentBadge });
    ctx.registerSettingsSection({
      id: "assets",
      title: t("智能体 / 提示词"),
      description: t("可复用资产:composer 里 !! 插入提示词正文,## 挂载智能体(发送时尾拼角色块)。"),
      icon: <Robot size="0.875rem" aria-hidden />,
      order: 45,
      tabs: [
        {
          id: "agents",
          title: t("智能体"),
          icon: <Robot size="0.875rem" aria-hidden />,
          order: 0,
          component: AgentTab,
        },
        {
          id: "prompts",
          title: t("提示词库"),
          icon: <Quotes size="0.875rem" aria-hidden />,
          order: 1,
          component: PromptTab,
        },
      ],
    });
  },
};

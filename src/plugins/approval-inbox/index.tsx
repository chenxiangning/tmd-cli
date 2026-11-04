/**
 * 审批收件箱插件 —— 右栏「审批」页签:聚合等待确认会话,直达与自由文本应答。
 * 检测零新增(纯消费 kernel/askWatch 既有状态位);预设代发键不做(M2 评审 A2)。
 * 提案:openspec/changes/2026-09-25-approval-inbox/;原型:docs/design/approval-inbox.html
 */
import { BellRinging } from "@phosphor-icons/react";
import type { Plugin } from "@kernel/plugin";
import { getSettingsState } from "@kernel/settings";
import { ApprovalInboxPanel } from "./panel";
import { bootApprovalInbox } from "./store";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const approvalInboxPlugin: Plugin = {
  id: "approval-inbox",
  meta: {
    name: "审批收件箱",
    abbr: "AB",
    desc: "聚合等待确认的会话:一键直达与自由文本应答",
    icon: BellRinging,
    iconColor: "#949800",
    category: "feature",
  },
  activate(ctx) {
    /* D-01 合并:checkpoints 启用时其「处理」宿主已内含等待域,本插件不再注册
     * 独立 rail 项(防双入口);仅 checkpoints 禁用时注册原「审批」面板兜底。
     * 后台 boot 始终随本插件启停 —— 组合语义见 implementation.md D-01。 */
    const checkpointsOff = getSettingsState().settings.disabledPlugins.includes("checkpoints");
    if (checkpointsOff) {
      ctx.registerFilePanel({
        id: "approval-inbox",
        label: "审批",
        icon: BellRinging,
        component: ApprovalInboxPanel,
        order: 13, /* 紧随处理(12),语义相邻 */
        railGroup: "session",
      });
    }
    return bootApprovalInbox(ctx.events);
  },
};

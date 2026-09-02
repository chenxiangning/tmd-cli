/**
 * session-budget 插件 —— 会话列表显示预算(独立插头,插件市场可插拔)。
 *
 * - 职责:caption 入口按钮 + 预算弹窗(BudgetPopover),经挂载点
 *   leftSidebar.workspaceCaption 贡献进工作区标题行;workspace 不感知本插件。
 * - 消费门控:SessionList 依 host.isPluginActive("session-budget") 决定是否按
 *   预算分页 —— 拔出 = 完全断电(回默认分页 10 条 + 更多翻倍);预算数值保留在
 *   settings.sessionListBudget,重新插入后继续生效。
 * - 数据:预算数值归 kernel/settings 所有,本插件只是编辑器(校验见 budgetCommit)。
 */

import { useState } from "react";
import { Gauge, ListTree } from "lucide-react";
import type { Plugin } from "@kernel/plugin";
import { BudgetPopover, clampBudgetPosition } from "./BudgetPopover";

/** 工作区标题行入口:按钮 + 弹窗自持状态(挂载点组件,无外部 props)。 */
function CaptionBudgetButton() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <button
        className="ws-caption-btn"
        title="会话列表显示预算"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setPos(
            pos ? null : clampBudgetPosition(rect.left, rect.bottom + 6),
          );
        }}
      >
        <ListTree size={13} aria-hidden />
      </button>
      {pos && <BudgetPopover position={pos} onClose={() => setPos(null)} />}
    </>
  );
}

export const sessionBudgetPlugin: Plugin = {
  id: "session-budget",
  meta: {
    name: "会话列表预算",
    abbr: "预算",
    desc: "工作区会话列表的磁盘历史露出预算(caption 弹窗编辑)",
    icon: Gauge,
    iconColor: "#E8B84D",
    category: "feature",
  },
  activate(ctx) {
    ctx.contribute("leftSidebar.workspaceCaption", {
      order: 0,
      component: CaptionBudgetButton,
    });
  },
};

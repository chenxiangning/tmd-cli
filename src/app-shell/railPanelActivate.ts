/**
 * rail 面板 icon 点击语义(2026-09-30 交互修正):
 * - 互斥只发生在右侧容器:点击 = 右栏切到该面板并展开;已激活且右栏展开
 *   再点 = 仅折叠右栏(纯容器开关)。
 * - 中央 tab 不参与互斥:声明 centerTab 的面板(hub 类)在打开方向幂等
 *   打开/聚焦自己的中央 tab,不关闭任何其他中央 tab;中央 tab 与普通 tab
 *   同权,生命周期归用户(tab 条自行关闭)。skill/mcp/日志等管理页因此
 *   可在中央区并存(2026-09-29「中央区不堆积管理 tab」的联动关闭已废)。
 * rail 直挂动作(终端/WSL/画布等)不经此函数,保持各自原语义。
 */

import { setFilePanelMode, type FilePanelContribution } from "@kernel/filePanel";

export function activateRailPanel(
  panel: FilePanelContribution,
  ctx: {
    mode: string;
    rightOpen: boolean;
    setRightOpen: (open: boolean) => void;
  },
): void {
  if (panel.id === ctx.mode && ctx.rightOpen) {
    ctx.setRightOpen(false);
    return;
  }
  /* 激活但折叠的 centerTab 面板:再点 = 聚焦既有中央 tab(open 幂等),不重开
   * 右栏——右栏对 hub 类只是副展示,重开它会把用户从要看的 tab 拉走。 */
  if (panel.id === ctx.mode && !ctx.rightOpen && panel.centerTab) {
    panel.centerTab.open();
    return;
  }
  setFilePanelMode(panel.id);
  panel.centerTab?.open();
  ctx.setRightOpen(true);
}

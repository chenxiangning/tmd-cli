/**
 * rail 面板 icon 点击语义(2026-09-29 交互优化):
 * - 未激活:切换右栏面板并展开右栏;声明 centerTab 的面板(hub 类)联动打开
 *   其中央 tab,同时关闭其他 hub 遗留的中央 tab(中央区不堆积管理 tab)。
 * - 已激活且右栏展开:收起 = 关掉自己的中央 tab 并折叠右栏(完整复位)。
 * - 已激活但右栏已折叠:再点即恢复 = 重开中央 tab 并展开右栏(可逆循环)。
 * rail 直挂动作(终端/WSL/画布等)不经此函数,保持各自原语义。
 */

import { setFilePanelMode, type FilePanelContribution } from "@kernel/filePanel";
import { closeTab } from "@kernel/tabs";

export function activateRailPanel(
  panel: FilePanelContribution,
  ctx: {
    panels: readonly FilePanelContribution[];
    mode: string;
    rightOpen: boolean;
    setRightOpen: (open: boolean) => void;
  },
): void {
  if (panel.id === ctx.mode && ctx.rightOpen) {
    if (panel.centerTab) closeTab(panel.centerTab.id);
    ctx.setRightOpen(false);
    return;
  }
  if (panel.id !== ctx.mode) {
    for (const q of ctx.panels) {
      if (q.centerTab && q.id !== panel.id) closeTab(q.centerTab.id);
    }
  }
  setFilePanelMode(panel.id);
  panel.centerTab?.open();
  ctx.setRightOpen(true);
}

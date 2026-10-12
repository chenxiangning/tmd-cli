/**
 * 工作台 · 页签 → 视图分发(查表,零分支;自 WorkbenchOverlay 拆出复杂度)。
 * 2026-10-12 三撤一合:项目列表/时间线/待跟进 → 聚焦页(FocusScreen)。
 */

import { OverviewScreen } from "./screens/Overview";
import { FocusScreen } from "./screens/FocusScreen";
import { TaskBoardScreen } from "./screens/TaskBoard";
import { JournalTab } from "./journal/JournalTab";
import { DocGenCenter } from "./DocGenCenter";
import type { ComponentType } from "react";
import type { WbScreenProps } from "./screens/cards";
import type { WbTab } from "./wbTabs";

const SCREENS: Record<WbTab, ComponentType<WbScreenProps>> = {
  overview: OverviewScreen,
  focus: FocusScreen,
  board: TaskBoardScreen,
  docs: DocGenCenter, /* 文档中心(自足组件;深链过滤经 screenProps.docsFilter) */
  journal: JournalTab, /* 自足组件(无 screenProps 依赖);视图态经 localStorage 自持 */
};

export function WbScreen({ tab, screenProps }: { tab: WbTab; screenProps: WbScreenProps }) {
  const Screen = SCREENS[tab];
  return <Screen {...screenProps} />;
}

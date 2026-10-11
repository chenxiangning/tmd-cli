/**
 * 工作台 · 页签 → 视图分发(查表,零分支;自 WorkbenchOverlay 拆出复杂度)。
 */

import type { ComponentType } from "react";
import { OverviewScreen } from "./screens/Overview";
import { TaskBoardScreen } from "./screens/TaskBoard";
import { ListScreen } from "./screens/ListScreen";
import { CalendarScreen } from "./screens/CalendarScreen";
import { TimelineScreen } from "./screens/TimelineScreen";
import { FollowupsScreen } from "./screens/Followups";
import type { WbScreenProps } from "./screens/cards";
import type { WbTab } from "./wbTabs";

const SCREENS: Record<WbTab, ComponentType<WbScreenProps>> = {
  overview: OverviewScreen,
  board: TaskBoardScreen,
  list: ListScreen,
  calendar: CalendarScreen,
  timeline: TimelineScreen,
  followups: FollowupsScreen,
};

export function WbScreen({ tab, screenProps }: { tab: WbTab; screenProps: WbScreenProps }) {
  const Screen = SCREENS[tab];
  return <Screen {...screenProps} />;
}

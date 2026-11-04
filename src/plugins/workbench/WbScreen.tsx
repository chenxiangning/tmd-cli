/**
 * 工作台 · 页签 → 视图分发(查表,零分支;自 WorkbenchOverlay 拆出复杂度)。
 * 2026-10-12 三撤一合:项目列表/时间线/待跟进 → 聚焦页(FocusScreen)。
 */

import { OverviewScreen } from "./screens/Overview";
import { FocusScreen } from "./screens/FocusScreen";
import { TaskBoardScreen } from "./screens/TaskBoard";
import { ReviewTab } from "./review/ReviewTab";
import { DocGenCenter } from "./DocGenCenter";
import type { ComponentType } from "react";
import type { WbScreenProps } from "./screens/cards";
import type { WbTab } from "./wbTabs";

/** journal 主 tab 已扩成「回顾」(C-01):经壳接二级视图,深链 review payload 透传。 */
function ReviewScreen(props: WbScreenProps) {
  return <ReviewTab review={props.review} />;
}

const SCREENS: Record<WbTab, ComponentType<WbScreenProps>> = {
  overview: OverviewScreen,
  focus: FocusScreen,
  board: TaskBoardScreen,
  docs: DocGenCenter, /* 文档中心(自足组件;深链过滤经 screenProps.docsFilter) */
  journal: ReviewScreen, /* 回顾壳:工作日志/每日足迹/会话活动 二级视图(C-01) */
};

export function WbScreen({ tab, screenProps }: { tab: WbTab; screenProps: WbScreenProps }) {
  const Screen = SCREENS[tab];
  return <Screen {...screenProps} />;
}

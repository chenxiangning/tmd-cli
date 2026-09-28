/**
 * 抽屉落位裁决 —— 纯函数(测试缝;spec 2026-09-28 落位语义)。
 *
 * 规则(可见响应优先,2026-09-28 真机反馈返工):
 * 1. fresh(本次开帧):立即落意图分区,无意图落「全部」;
 * 2. 有意图且未落:立即切到意图分区 —— 空区先显「暂无」也是可见响应,
 *    终拍校正(旧版等 resolved 才落,慢引擎 5-6s 窗口内点击无反馈、
 *    二击反变关闭,违背「显示和关闭」一致性,真机返工裁决);
 * 3. resolved 终拍:当前 tab 不在实况 sections(空区回落 / 切 profile 归一)→「全部」。
 * 返回 null = 不动。
 */

import type { DrawerSection } from "../drawerItems";
import type { DrawerTab } from "../state/drawerOpen";

export function nextDrawerTab(args: {
  tab: DrawerTab;
  want: DrawerSection | null;
  resolved: boolean;
  sections: readonly DrawerSection[];
  fresh: boolean;
}): DrawerTab | null {
  const { tab, want, resolved, sections, fresh } = args;
  if (fresh) return want ?? "all";
  if (want && tab !== want) return want;
  if (resolved && tab !== "all" && !sections.includes(tab)) return "all";
  return null;
}

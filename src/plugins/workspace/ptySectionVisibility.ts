/**
 * PTY 小节头可见性上报面(2026-11-05 图 2 结构)—— 各引擎组(CliSessionGroup)
 * 写、工作区卡读的外部 store:「整组为空不占位」的判定只活在组内,小节头聚合
 * (任一组可见即出)经订阅面拿,不走 prop 回调 effect(react-doctor
 * no-prop-callback-in-effect / no-pass-live-state-to-parent)。
 * key = `${workspaceId}:${profileId}`:组按工作区×引擎双维挂载(折叠卡 children
 * 常驻 inert),单 profileId 键会让空工作区的组覆写有行工作区的值,小节头莫名
 * 消失(2026-11-06 大仙实证);按工作区分域后卸载残留只影响已卸载卡自身的键,
 * 读侧无扰。
 */
import { createSubscribable } from "@kernel/subscribable";

const visibility = new Map<string, boolean>();

const store = createSubscribable<ReadonlyMap<string, boolean>>(new Map(visibility));

export function ptyVisibilityKey(workspaceId: string, profileId: string): string {
  return `${workspaceId}:${profileId}`;
}

/** 组可见性覆写(同值不提交,读侧零扰)。 */
export function notePtyGroupVisible(workspaceId: string, profileId: string, visible: boolean): void {
  const key = ptyVisibilityKey(workspaceId, profileId);
  if (visibility.get(key) === visible) return;
  visibility.set(key, visible);
  store.commit(new Map(visibility));
}

/** 工作区卡订阅(PtySectionLabel 消费)。 */
export function usePtyVisibility(): ReadonlyMap<string, boolean> {
  return store.useStore();
}

/** 非 React 读侧(测试用):当前可见表快照,引用稳定。 */
export const ptyVisibilitySnapshot = (): ReadonlyMap<string, boolean> => store.snapshot;

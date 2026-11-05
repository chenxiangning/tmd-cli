/**
 * PTY 小节头可见性上报面(2026-11-05 图 2 结构)—— 各引擎组(CliSessionGroup)
 * 写、工作区卡读的外部 store:「整组为空不占位」的判定只活在组内,小节头聚合
 * (任一组可见即出)经订阅面拿,不走 prop 回调 effect(react-doctor
 * no-prop-callback-in-effect / no-pass-live-state-to-parent)。key = profileId;
 * 组挂载期随判定变化覆写,卸载残留值由读侧 profiles 集合兜住。
 */
import { createSubscribable } from "@kernel/subscribable";

const visibility = new Map<string, boolean>();

const store = createSubscribable<ReadonlyMap<string, boolean>>(new Map(visibility));

/** 组可见性覆写(同值不提交,读侧零扰)。 */
export function notePtyGroupVisible(profileId: string, visible: boolean): void {
  if (visibility.get(profileId) === visible) return;
  visibility.set(profileId, visible);
  store.commit(new Map(visibility));
}

/** 工作区卡订阅(PtySectionLabel 消费)。 */
export function usePtyVisibility(): ReadonlyMap<string, boolean> {
  return store.useStore();
}

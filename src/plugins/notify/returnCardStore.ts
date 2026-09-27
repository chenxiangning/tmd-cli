/**
 * 回窗待办卡 store —— 失焦回窗的「等待确认」聚合快照(spec 2026-09-27)。
 *
 * - 触发 = window focus 边沿且此前确实失焦过(index.tsx wasBlurred 闸,首启不弹);
 *   成员 = host.isWaitingConfirm 现查(内核真相位,检测零新增)。
 * - 收卡 = 行全部解决(turnSettled/退出/点击后移除)或手关;聚焦期新增 ask 边沿入卡。
 * 逻辑与组件拆文件:react-doctor only-export-components(组件留 .tsx,状态机在此)。
 */
import { host } from "@kernel/host";
import { createSubscribable } from "@kernel/subscribable";

export interface ReturnState {
  /** 等待中的会话 id 集(开卡时刻快照 + 聚焦期增量;空 = 收卡)。 */
  readonly ids: readonly string[];
}

const store = createSubscribable<ReturnState>({ ids: [] });

/** 非 React 快照读取(测试断言;approvalInboxSnapshot 同款)。 */
export function returnCardSnapshot(): ReturnState {
  return store.snapshot;
}

/** React 订阅(overlay 挂点组件渲染面)。 */
export function useReturnCard(): ReturnState {
  return store.useStore();
}

/** 回窗触发:现查等待集开卡;空集不开(无待办不打扰)。 */
export function openOnFocusReturn(): void {
  const ids = host
    .getSessions()
    .filter((s) => host.isWaitingConfirm(s.id))
    .map((s) => s.id);
  if (ids.length > 0) store.commit({ ids });
}

/** 聚焦期新增 ask 边沿入卡;卡片未开时 no-op(聚焦期提醒走既有界内红点)。 */
export function addReturnRow(sessionId: string): void {
  const { ids } = store.snapshot;
  if (ids.length === 0 || ids.includes(sessionId)) return;
  store.commit({ ids: [...ids, sessionId] });
}

/** 行解决(turnSettled/退出/点击后)移除;清空即收卡。 */
export function resolveReturnRow(sessionId: string): void {
  const { ids } = store.snapshot;
  if (!ids.includes(sessionId)) return;
  store.commit({ ids: ids.filter((x) => x !== sessionId) });
}

/** 手动关闭(幂等)。 */
export function closeReturnCard(): void {
  if (store.snapshot.ids.length === 0) return;
  store.commit({ ids: [] });
}

/** 测试专用:清空模块状态(vitest 复用同一模块实例)。 */
export function resetReturnCardForTest(): void {
  store.commit({ ids: [] });
}

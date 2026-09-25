/**
 * 自建中继一键部署步骤状态机纯函数(WebSelfHostCard 消费,拆文件对齐
 * relayStatusModel 先例:only-export-components / no-high-complexity)。
 * 输入 = 是否已提交 + 进度事件流(web-relay-deploy)+ 最终 result(可 null);
 * 输出 = 每步 pending/running/ok/failed。step id 序列是 Rust 侧固定契约。
 */

import type { RelayDeployProgress, SelfhostDeployResult } from "@kernel/ipc";

export type SelfhostStepId = "connect" | "cert" | "upload" | "systemd" | "health";
export type SelfhostStepState = "pending" | "running" | "ok" | "failed";

/** Rust step id 固定序列(契约:connect → cert → upload → systemd → health)。 */
export const SELFHOST_STEPS: SelfhostStepId[] = [
  "connect",
  "cert",
  "upload",
  "systemd",
  "health",
];

/** 事件流/Rust steps 数组里只认契约内的 id(杂散事件不进 checklist)。 */
function settledPairs(
  result: SelfhostDeployResult | null,
  events: RelayDeployProgress[],
): { step: string; ok: boolean }[] {
  if (result) return result.steps.map((s) => ({ step: s.id, ok: s.ok }));
  return events.filter((e) => (SELFHOST_STEPS as string[]).includes(e.step));
}

export function deriveStepStates(
  submitted: boolean,
  events: RelayDeployProgress[],
  result: SelfhostDeployResult | null,
): Record<SelfhostStepId, SelfhostStepState> {
  const states = {} as Record<SelfhostStepId, SelfhostStepState>;
  for (const s of SELFHOST_STEPS) states[s] = "pending";
  if (result?.ok) {
    for (const s of SELFHOST_STEPS) states[s] = "ok";
    return states;
  }
  if (!submitted) return states;
  /* result 落定(失败)后以其 steps 数组为准;进行中用进度事件流。 */
  const settled = settledPairs(result, events);
  let lastOk = -1;
  let failedAt = -1;
  for (const e of settled) {
    const i = SELFHOST_STEPS.indexOf(e.step as SelfhostStepId);
    if (i < 0) continue;
    states[SELFHOST_STEPS[i]] = e.ok ? "ok" : "failed";
    if (e.ok) lastOk = Math.max(lastOk, i);
    else if (failedAt < 0) failedAt = i;
  }
  /* 失败步之后一律 pending:Rust 失败时 steps 数组可能把后续步也记 ok=false,
     但用户视角那几步根本没跑到;重放幂等,修复后整序重来。 */
  if (failedAt >= 0) {
    for (let i = failedAt + 1; i < SELFHOST_STEPS.length; i++)
      states[SELFHOST_STEPS[i]] = "pending";
    return states;
  }
  /* 进行中的「下一步转圈」:仅事件流态(最终 result 已落定,不再猜)。 */
  if (!result && lastOk + 1 < SELFHOST_STEPS.length)
    states[SELFHOST_STEPS[lastOk + 1]] = "running";
  return states;
}

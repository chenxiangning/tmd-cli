/**
 * checkpoints 保留策略与强退恢复收口(自 store.ts 拆出守 300 行铁则)。
 * 两件事都是「每 cwd 每运行一次」的低频启动/挂载语义,内聚一处。
 */
import { ipc } from "@kernel/ipc";

/** 与面板「100/30 天」文案一致:每 cwd 保最近 100 批、超期 30 天清理。 */
const CKPT_KEEP = 100;
const CKPT_TTL_DAYS = 30;

/** 已执行过清理的 cwd:面板挂载时低频触发,同 cwd 不重复跑。 */
const prunedCwds = new Set<string>();

/** 保留策略清理:面板挂载/切换工作区时调用一次;失败静默(下次挂载重试)。 */
export function pruneRetention(cwd: string): void {
  if (prunedCwds.has(cwd)) return;
  prunedCwds.add(cwd);
  ipc
    .checkpointPrune(cwd, CKPT_KEEP, CKPT_TTL_DAYS)
    .catch(() => prunedCwds.delete(cwd));
}

/** 已执行死锚点收口的 cwd:每 cwd 每运行一次(强退恢复是启动期语义)。 */
const sealedDeadCwds = new Set<string>();

/** 死锚点新鲜度保护:不误封本运行刚打的在途锚点(误封亦无损失,封口是
 *  修订追加 —— 此宽限只是让「进行中」批不被提前翻成「待审」)。 */
const SEAL_DEAD_GRACE_MS = 60_000;

/**
 * 强退恢复:上一运行被 kill 的会话没有 sessionExited,最后一段轮次永远是
 * 开放锚点 —— 直到下次记账/收口前,它的批次在时间线上不可见。面板首次
 * 挂载时按 cwd 触发一次,随后紧跟一次清单刷新把恢复出的批带出来。
 * 失败允许重试(移除标记,下次挂载再收)。
 */
export function sealDeadTurns(cwd: string): Promise<void> {
  if (!cwd || sealedDeadCwds.has(cwd)) return Promise.resolve();
  sealedDeadCwds.add(cwd);
  return ipc
    .checkpointSealDead(cwd, SEAL_DEAD_GRACE_MS)
    .catch(() => sealedDeadCwds.delete(cwd))
    .then(() => undefined);
}

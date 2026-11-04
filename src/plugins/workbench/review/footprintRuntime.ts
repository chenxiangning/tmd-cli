/**
 * footprint 写侧 runtime(2026-11-04 自 footprint 插件迁入 workbench「回顾」域)。
 *
 * 只迁订阅装配责任,算法事实源不动(仍在 footprint 数据层):
 * - ckptTurnSealed → activateRollup 单飞队列落按月 rollup(footprint/rollup);
 * - 封口到达 → bumpFootprintRev 视图 live 轻刷新信号(footprint/fpTab);
 * - 功能卡随日报生成会话直写,不经封口账:文件写事件命中 /footprint/features/ 即 bump。
 *
 * 写路径归回顾域后,footprint UI 插件禁用不中断落账;补账触发仍由视图首次挂载
 * 承担(footprint/backfill.reconcileOnce),不经本 runtime。
 */
import { KernelTopics, type CkptTurnSealedEvent } from "@kernel/events";
import type { PluginContext } from "@kernel/plugin";
import { activateRollup } from "./footprint/rollup";
import { bumpFootprintRev } from "./footprint/fpTab";

/** 装配 footprint 写侧订阅;返回退订(随 workbench deactivate 一并清理)。 */
export function attachFootprintRuntime(ctx: PluginContext): () => void {
  /* 写侧装配:封口事件 → 单飞队列落按月 rollup(数据层,返回退订)。 */
  const offRollup = activateRollup(ctx.events);
  /* 视图 live 信号:封口到达即 bump,当日视图/月历轻刷新(纯读重拉)。 */
  const offSealed = ctx.events.on<CkptTurnSealedEvent>(KernelTopics.ckptTurnSealed, () => {
    bumpFootprintRev();
  });
  /* 功能卡随日报生成会话直写,不经封口账:文件写事件命中 features 即刷新。 */
  const offEdit = ctx.events.on<{ sessionId: string; paths: string[] }>(
    KernelTopics.fileEditDetected,
    (e) => {
      if (e.paths.some((p) => p.includes("/footprint/features/"))) bumpFootprintRev();
    },
  );
  return () => {
    offRollup();
    offSealed();
    offEdit();
  };
}

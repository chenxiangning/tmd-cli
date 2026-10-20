/**
 * footprint —— 每日工作足迹插件(中央 tab)。
 *
 * 月历热力定位到天、当日功能卡流(AI 归纳 + 用户原话锚点)、证据抽屉
 * (会话 resume / 文件清单 / 宽 diff)、⌘K 反查、shift 区间汇总、git 硬证据。
 * 数据契约见 docs/superpowers/specs/2026-10-19-footprint-design.md;
 * 写侧 rollup(ckptTurnSealed → 按月 rollup)与读侧 query 均由数据层承担,
 * 本插件只做注册面装配 + 视图 live 轻刷新信号,不维护写路径。
 */
import { Footprints } from "@phosphor-icons/react";
import { lazySuspense } from "@kernel/lazyTab";
import { KernelTopics, type CkptTurnSealedEvent } from "@kernel/events";
import type { Plugin, PluginContext } from "@kernel/plugin";
import { bumpFootprintRev, FP_TAB_KIND, openFootprintTab } from "./fpTab";
import { activateRollup } from "./rollup";
import "./locales"; /* 域词典随插件自带:import 即注册 */

export const footprintPlugin: Plugin = {
  id: "footprint",
  meta: {
    name: "每日工作足迹",
    abbr: "足迹",
    desc: "月历热力 + 功能卡流 + 证据抽屉:反查任意一天做了什么",
    icon: Footprints,
    iconColor: "#4f8dff",
    category: "feature",
  },
  activate(ctx: PluginContext) {
    ctx.registerTabContent({
      kind: FP_TAB_KIND,
      component: lazySuspense(() => import("./view/FootprintView").then((m) => ({ default: m.FootprintView }))),
      icon: Footprints,
      keepAlive: true, /* 切 tab 不卸载:选中日/区间/卡片选择等视图态跨切换保留(先例 workbench) */
    });
    /* 左 rail 入口(排序 46:动画 45 之后)。 */
    ctx.registerSidebarAction({
      id: "footprint",
      label: "每日足迹",
      icon: Footprints,
      order: 46,
      leftRail: true,
      active: () => false,
      onSelect: () => openFootprintTab(),
    });
    /* 写侧装配:封口事件 → 单飞队列落按月 rollup(数据层,返回退订)。 */
    const offRollup = activateRollup(ctx.events);
    /* 视图 live 信号:封口到达即 bump,当日视图/月历轻刷新(纯读重拉)。 */
    const offSealed = ctx.events.on<CkptTurnSealedEvent>(KernelTopics.ckptTurnSealed, () => {
      bumpFootprintRev();
    });
    /* 功能卡随日报生成会话直写,不经封口账:文件写事件命中 features 即刷新。 */
    const offEdit = ctx.events.on<{ sessionId: string; paths: string[] }>(KernelTopics.fileEditDetected, (e) => {
      if (e.paths.some((p) => p.includes("/footprint/features/"))) bumpFootprintRev();
    });
    return () => {
      offRollup();
      offSealed();
      offEdit();
    };
  },
};

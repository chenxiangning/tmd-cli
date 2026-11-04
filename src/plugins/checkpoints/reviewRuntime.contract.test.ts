/**
 * 「处理」合并双插件运行矩阵契约(批次 B-03;D-01 合并 UI 的前置测试缝)。
 *
 * 固定四条原则:
 * 1. approval-inbox 独占 askDetected/host.subscribe 与 1.5s 重同步;
 * 2. checkpoints 独占 promptSent/fileEditDetected/turnSettled/sessionExited
 *    (含 cliIdentityProbe)与 4s 磁盘事件拉取;
 * 3. 只合 UI,不合 Ask 状态机、checkpoint 账本或历史 key —— 数据契约仍由各
 *    插件自身测试守,本矩阵只钉「订阅责任不串、不双份」的运行边界;
 * 4. both / only approval / only checkpoints 三种在场组合各有可用面板,
 *    不出现零入口或双份 boot;
 *
 * 只读注册面(registerFilePanel 记录 + 事件总线 topic 计数 + host.subscribe
 * 计数),不触发写路径;各组合 activate 后即时 deactivate,零泄漏。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventBus, KernelTopics } from "@kernel/events";
import { host } from "@kernel/host";
import type { Plugin } from "@kernel/plugin";
import { approvalInboxPlugin } from "@plugins/approval-inbox/index";
import { checkpointsPlugin } from "./index";

/** 记录订阅 topic 的事件总线包装(结构同 PluginEventBus)。 */
function recordingBus() {
  const bus = new EventBus();
  const counts = new Map<string, number>();
  return {
    counts,
    bus: {
      on(topic: string, handler: (payload: never) => void) {
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
        return bus.on(topic, handler);
      },
      emit: bus.emit.bind(bus),
    },
  };
}

interface Harness {
  panels: string[];
  tabs: string[];
  counts: Map<string, number>;
  hostSubscribeCalls: number;
}

const detaches: Array<() => void> = [];
afterEach(() => {
  while (detaches.length) detaches.pop()!();
  vi.restoreAllMocks();
});

/** 按组合 activate 启用的插件,记录注册面后由 afterEach 统一 deactivate。 */
function runCombo(opts: { approval: boolean; checkpoints: boolean }): Harness {
  const rec = recordingBus();
  const panels: string[] = [];
  const tabs: string[] = [];
  const ctx = {
    registerFilePanel: (p: { id: string }) => panels.push(p.id),
    registerTabContent: (t: { kind: string }) => tabs.push(t.kind),
    events: rec.bus,
  };
  const subscribeSpy = vi.spyOn(host, "subscribe");
  const plugins: Plugin[] = [
    ...(opts.checkpoints ? [checkpointsPlugin] : []),
    ...(opts.approval ? [approvalInboxPlugin] : []),
  ];
  for (const p of plugins) {
    const off = p.activate(ctx as never);
    if (typeof off === "function") detaches.push(off);
  }
  return {
    panels,
    tabs,
    counts: rec.counts,
    hostSubscribeCalls: subscribeSpy.mock.calls.length,
  };
}

const count = (h: Harness, topic: string) => h.counts.get(topic) ?? 0;

/* checkpoints 独占的会话写事件(原则 2)。 */
const CKPT_TOPICS = [
  KernelTopics.promptSent,
  KernelTopics.fileEditDetected,
  KernelTopics.turnSettled,
  KernelTopics.sessionExited,
  KernelTopics.cliIdentityProbe,
] as const;

describe("「处理」合并双插件运行矩阵", () => {
  it("both:两面板各一份,订阅各归各,无零入口无双份 boot", () => {
    const h = runCombo({ approval: true, checkpoints: true });
    expect(h.panels).toEqual(["checkpoints", "approval-inbox"]);
    expect(h.tabs).toContain("ckpt-batch");
    /* 原则 1:ask/host 订阅恰一份(来自 approval-inbox)。 */
    expect(count(h, KernelTopics.askDetected)).toBe(1);
    expect(h.hostSubscribeCalls).toBe(1);
    /* 原则 2:写事件订阅恰一份(来自 checkpoints)。 */
    for (const t of CKPT_TOPICS) expect(count(h, t)).toBe(1);
  });

  it("only approval:审批面板在场、审批线缺席;写事件零订阅", () => {
    const h = runCombo({ approval: true, checkpoints: false });
    expect(h.panels).toEqual(["approval-inbox"]);
    expect(count(h, KernelTopics.askDetected)).toBe(1);
    expect(h.hostSubscribeCalls).toBe(1);
    for (const t of CKPT_TOPICS) expect(count(h, t)).toBe(0);
  });

  it("only checkpoints:审批线在场、审批面板缺席;ask 零订阅", () => {
    const h = runCombo({ approval: false, checkpoints: true });
    expect(h.panels).toEqual(["checkpoints"]);
    expect(h.tabs).toContain("ckpt-batch");
    expect(count(h, KernelTopics.askDetected)).toBe(0);
    expect(h.hostSubscribeCalls).toBe(0);
    for (const t of CKPT_TOPICS) expect(count(h, t)).toBe(1);
  });
});

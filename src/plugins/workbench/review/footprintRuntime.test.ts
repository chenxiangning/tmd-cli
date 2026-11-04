/**
 * footprint 写侧 runtime 装配契约(2026-11-04 自 footprint 插件迁入 workbench):
 * - attach 后经 ctx.events 收 ckptTurnSealed → bumpFootprintRev(视图 live 信号);
 * - fileEditDetected 命中 /footprint/features/ → bump;其余路径不 bump;
 * - rollup 订阅责任一并装配(数据层 activateRollup,单飞语义由其自身测试守);
 * - 退订后事件不再触达(无幽灵写)。
 * mock 数据层两入口,装配逻辑真件。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, KernelTopics, type CkptTurnSealedEvent } from "@kernel/events";

const rollupMock = vi.hoisted(() => ({ activateRollup: vi.fn(() => vi.fn()) }));
vi.mock("./footprint/rollup", () => rollupMock);

const fpTabMock = vi.hoisted(() => ({ bumpFootprintRev: vi.fn() }));
vi.mock("./footprint/fpTab", () => fpTabMock);

import { bumpFootprintRev } from "./footprint/fpTab";
import { activateRollup } from "./footprint/rollup";
import { attachFootprintRuntime } from "./footprintRuntime";

const bump = vi.mocked(bumpFootprintRev);
const activateRollupMock = vi.mocked(activateRollup);

function sealedEvent(): CkptTurnSealedEvent {
  return { cwd: "/proj", sessionId: "s1" } as CkptTurnSealedEvent;
}

describe("attachFootprintRuntime 写侧装配", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attach 即装配 rollup 订阅;退订时一并退订", () => {
    const events = new EventBus();
    const offRollup = vi.fn();
    activateRollupMock.mockReturnValue(offRollup);
    const detach = attachFootprintRuntime({ events } as never);
    expect(activateRollupMock).toHaveBeenCalledWith(events);
    detach();
    expect(offRollup).toHaveBeenCalledTimes(1);
  });

  it("封口到达 → bump 视图 live 信号", () => {
    const events = new EventBus();
    activateRollupMock.mockReturnValue(vi.fn());
    attachFootprintRuntime({ events } as never);
    events.emit(KernelTopics.ckptTurnSealed, sealedEvent());
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it("功能卡写事件命中 /footprint/features/ → bump;其他路径不 bump", () => {
    const events = new EventBus();
    activateRollupMock.mockReturnValue(vi.fn());
    attachFootprintRuntime({ events } as never);
    events.emit(KernelTopics.fileEditDetected, { sessionId: "s1", paths: ["/x/footprint/features/2026-11-04.json"] });
    expect(bump).toHaveBeenCalledTimes(1);
    events.emit(KernelTopics.fileEditDetected, { sessionId: "s1", paths: ["/proj/src/main.ts"] });
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it("退订后:封口/写事件都不再 bump(无幽灵写)", () => {
    const events = new EventBus();
    activateRollupMock.mockReturnValue(vi.fn());
    const detach = attachFootprintRuntime({ events } as never);
    detach();
    events.emit(KernelTopics.ckptTurnSealed, sealedEvent());
    events.emit(KernelTopics.fileEditDetected, { sessionId: "s1", paths: ["/x/footprint/features/2026-11-04.json"] });
    expect(bump).not.toHaveBeenCalled();
  });
});

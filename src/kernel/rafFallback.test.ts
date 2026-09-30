import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transportInvoke = vi.hoisted(() => vi.fn());
vi.mock("./transport", () => ({ invoke: transportInvoke }));

/** 受控假 rAF 句柄:永不自动触发,由测试显式 fire,模拟 WebKit 遮挡期停发。 */
interface DeadRaf {
  raf: (cb: FrameRequestCallback) => number;
  caf: (id: number) => void;
  fire: (id: number, t?: number) => void;
  ids: () => number[];
}

function makeDeadRaf(): DeadRaf {
  const cbs = new Map<number, FrameRequestCallback>();
  let next = 1;
  const raf = vi.fn((cb: FrameRequestCallback) => {
    const id = next++;
    cbs.set(id, cb);
    return id;
  });
  const caf = vi.fn((id: number) => cbs.delete(id));
  return {
    raf,
    caf,
    fire: (id: number, t = 16.7) => cbs.get(id)?.(t),
    ids: () => [...cbs.keys()],
  };
}

type FakeWindow = {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  performance: Performance;
  __tmdRafFallbackInstalled?: boolean;
  __tmdRenderProbe?: () => void;
};

/* 动态 import 是用例本体:每个用例要在重置模块表后对「假 rAF 已就位」的
 * window 桩重新执行垫片的自安装,静态 import 拿到的是缓存过的已装实例。 */
async function freshInstall(dead: DeadRaf, hidden = false): Promise<FakeWindow> {
  vi.resetModules();
  transportInvoke.mockClear();
  const fakeWindow: FakeWindow = {
    requestAnimationFrame: dead.raf,
    cancelAnimationFrame: dead.caf,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    performance: globalThis.performance,
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", { hidden });
  await import("./rafFallback");
  return fakeWindow;
}

/** 动态 import 的 mock 模块链跨多个微任务批落定;纯微任务泵,不推进假时钟。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** 首帧点活原生探针(lastNativeFireAt 从 0 → 有值),粘死计时自此起算。 */
function primeProbe(dead: DeadRaf): void {
  dead.fire(dead.ids()[0]);
}

describe("rafFallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rAF 失活时 50ms 兜底触发回调且只跑一次", async () => {
    const dead = makeDeadRaf();
    const w = await freshInstall(dead);
    const cb = vi.fn();
    w.requestAnimationFrame(cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(1);
    /* 兜底已消费:再推进也不双跑 */
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("rAF 恢复时真帧先赢,兜底定时器被摘除不双跑", async () => {
    const dead = makeDeadRaf();
    const w = await freshInstall(dead);
    const cb = vi.fn();
    w.requestAnimationFrame(cb);
    /* wrap 返回自增 id,与原生 id 因探针注册错位:真帧 = 最新挂起的原生 id */
    const nativeId = dead.ids().at(-1)!;
    dead.fire(nativeId, 100);
    expect(cb).toHaveBeenCalledWith(100);
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    /* 真 rAF 已执行:内部登记摘除,迟到 fire 无害 */
    dead.fire(nativeId, 200);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("cancelAnimationFrame 双源同撤:兜底也不再触发", async () => {
    const dead = makeDeadRaf();
    const w = await freshInstall(dead);
    const cb = vi.fn();
    const id = w.requestAnimationFrame(cb);
    w.cancelAnimationFrame(id);
    expect(dead.caf).toHaveBeenCalled();
    dead.fire(dead.ids().at(-1)!, 100);
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();
  });

  it("重复 install 幂等,不连环包裹", async () => {
    const dead = makeDeadRaf();
    const w = await freshInstall(dead);
    const wrapped = w.requestAnimationFrame;
    const { installRafFallback } = await import("./rafFallback");
    installRafFallback();
    expect(w.requestAnimationFrame).toBe(wrapped);
  });

  it("形态 A:原生 rAF 停 ≥10s 且页面自认可见 → 上报 ok:false 且 10s 内去重", async () => {
    const dead = makeDeadRaf();
    await freshInstall(dead, false);
    primeProbe(dead);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(transportInvoke).toHaveBeenCalledTimes(1);
    expect(transportInvoke.mock.calls[0][0]).toBe("render_health");
    expect(transportInvoke.mock.calls[0][1]).toMatchObject({ ok: false });
    /* 上报去重:10s 窗口内不重复轰炸 */
    transportInvoke.mockClear();
    vi.advanceTimersByTime(5_000);
    await settle();
    expect(transportInvoke).not.toHaveBeenCalled();
  });

  it("形态 B:hidden 恒粘不再静默:照常上报 stuck,真伪可见性裁断归 Rust is_visible", async () => {
    const dead = makeDeadRaf();
    await freshInstall(dead, true);
    primeProbe(dead);
    vi.advanceTimersByTime(10_000);
    await settle();
    /* 页内 hidden 标记在吊销态会说谎:照常上报,Rust 按 window.is_visible()
       裁断(真隐藏不击打)。旧契约(hidden 即静默)依赖 Focused 事件再戳,
       窗口已聚焦时无事件,阶梯停首击永不自愈 —— 0.2.5 画布黑屏回归根因。 */
    expect(transportInvoke).toHaveBeenCalledTimes(1);
    expect(transportInvoke.mock.calls[0][1]).toMatchObject({ ok: false });
  });

  it("洪水标尺随上报携带:低速期 flood:false,灌洪越线后 flood:true", async () => {
    const dead = makeDeadRaf();
    await freshInstall(dead, false);
    const { notePtyBytes } = await import("./floodGauge");
    primeProbe(dead);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(transportInvoke.mock.calls[0][1]).toMatchObject({ ok: false, flood: false });
    /* 灌洪越线(>256KB/5s),去重窗(10s)内补喂保洪水不过期,过窗后再报 */
    notePtyBytes(300 * 1024);
    vi.advanceTimersByTime(9_000);
    notePtyBytes(300 * 1024);
    vi.advanceTimersByTime(1_000);
    await settle();
    expect(transportInvoke).toHaveBeenCalledTimes(2);
    expect(transportInvoke.mock.calls[1][1]).toMatchObject({ ok: false, flood: true });
  });

  it("健康恢复上报:粘死后原生 rAF 复活 → ok:true 复位(免去重)", async () => {
    const dead = makeDeadRaf();
    await freshInstall(dead, false);
    primeProbe(dead);
    vi.advanceTimersByTime(10_000);
    await settle();
    expect(transportInvoke).toHaveBeenCalledTimes(1);
    /* 原生 rAF 复活(补发挂起帧),随后看门狗观测到小间隙 */
    dead.fire(dead.ids().at(-1)!);
    vi.advanceTimersByTime(1_000);
    await settle();
    const last = transportInvoke.mock.calls.at(-1);
    expect(last?.[1]).toMatchObject({ ok: true });
  });
});

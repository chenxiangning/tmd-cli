import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 受控假 rAF 句柄:永不自动触发,由测试显式 fire,模拟 WebKit 遮挡期停发。 */
interface DeadRaf {
	raf: (cb: FrameRequestCallback) => number;
	caf: (id: number) => void;
	fire: (id: number, t?: number) => void;
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
	return { raf, caf, fire: (id: number, t = 16.7) => cbs.get(id)?.(t) };
}

type FakeWindow = {
	requestAnimationFrame: (cb: FrameRequestCallback) => number;
	cancelAnimationFrame: (id: number) => void;
	setTimeout: typeof setTimeout;
	clearTimeout: typeof clearTimeout;
	performance: Performance;
	__tmdRafFallbackInstalled?: boolean;
};

/* 动态 import 是用例本体:每个用例要在重置模块表后对「假 rAF 已就位」的
 * window 桩重新执行垫片的自安装,静态 import 拿到的是缓存过的已装实例。 */
async function freshInstall(dead: DeadRaf): Promise<FakeWindow> {
	vi.resetModules();
	const fakeWindow: FakeWindow = {
		requestAnimationFrame: dead.raf,
		cancelAnimationFrame: dead.caf,
		setTimeout: globalThis.setTimeout,
		clearTimeout: globalThis.clearTimeout,
		performance: globalThis.performance,
	};
	vi.stubGlobal("window", fakeWindow);
	await import("./rafFallback");
	return fakeWindow;
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
		const id = w.requestAnimationFrame(cb);
		/* 真 rAF 在兜底窗口内先到 */
		dead.fire(id, 100);
		expect(cb).toHaveBeenCalledWith(100);
		vi.advanceTimersByTime(200);
		expect(cb).toHaveBeenCalledTimes(1);
		/* 真 rAF 已执行:内部登记摘除,迟到 fire 无害 */
		dead.fire(id, 200);
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it("cancelAnimationFrame 双源同撤:兜底也不再触发", async () => {
		const dead = makeDeadRaf();
		const w = await freshInstall(dead);
		const cb = vi.fn();
		const id = w.requestAnimationFrame(cb);
		w.cancelAnimationFrame(id);
		expect(dead.caf).toHaveBeenCalled();
		dead.fire(id, 100);
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
});

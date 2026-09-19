/**
 * platform 契约:
 * getPlatformKind —— UA 大小写不敏感识别 macos/windows/linux;未知 UA 与
 * navigator 缺失归 unknown;首次结果模块级缓存,后续 UA 变化不影响。
 * usePlatformKind —— 初值取 getPlatformKind;UA unknown 时挂载副作用经
 * ipc.platformKind 兜底,认识的 OS 回写状态并进缓存;Rust 侧不认识或请求
 * 失败时状态与缓存都不动;UA 已认识时不发兜底请求。
 * react 以最小桩替代渲染器(useState 直取初始化值,useEffect 捕获挂载副作用)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platformKind: vi.fn(),
  setKind: vi.fn(),
  mountEffect: undefined as (() => void) | undefined,
}));

vi.mock("@kernel/ipc", () => ({ platformKind: mocks.platformKind }));
vi.mock("react", () => ({
  useState: (init: unknown) => [
    typeof init === "function" ? (init as () => unknown)() : init,
    mocks.setKind,
  ],
  useEffect: (fn: () => void) => {
    mocks.mountEffect = fn;
  },
}));

type PlatformModule = typeof import("./platform");

/* 动态 import 例外:平台结论缓存在模块级单例里,静态 import 无法跨用例重置,
   必须借 resetModules + import() 取全新实例(同 terminalLinks.test.ts 范式)。 */

/** 桩 navigator;传 undefined 表示非浏览器环境(navigator 缺失)。 */
function stubNavigator(ua: string | undefined): void {
  vi.stubGlobal("navigator", ua === undefined ? undefined : { userAgent: ua });
}

beforeEach(() => {
  vi.resetModules();
  mocks.platformKind.mockReset();
  mocks.setKind.mockReset();
  mocks.mountEffect = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPlatformKind", () => {
  it("UA 识别三大平台且大小写不敏感", async () => {
    const cases: Array<[string, string]> = [
      ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "macos"],
      ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "windows"],
      ["Mozilla/5.0 (X11; Linux x86_64)", "linux"],
      ["Mozilla/5.0 (MAC OS X 99)", "macos"],
    ];
    for (const [ua, want] of cases) {
      vi.resetModules();
      stubNavigator(ua);
      const mod: PlatformModule = await import("./platform");
      expect(mod.getPlatformKind()).toBe(want);
    }
  });

  it("未知 UA 与 navigator 缺失归 unknown", async () => {
    stubNavigator("Mozilla/5.0 (SunOS)");
    let mod: PlatformModule = await import("./platform");
    expect(mod.getPlatformKind()).toBe("unknown");

    vi.resetModules();
    stubNavigator(undefined);
    mod = await import("./platform");
    expect(mod.getPlatformKind()).toBe("unknown");
  });

  it("首次结果缓存:UA 事后变化不影响返回值", async () => {
    stubNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    const mod: PlatformModule = await import("./platform");
    expect(mod.getPlatformKind()).toBe("macos");
    stubNavigator("Mozilla/5.0 (Windows NT 10.0)");
    expect(mod.getPlatformKind()).toBe("macos");
  });
});

describe("usePlatformKind", () => {
  it("初值取 getPlatformKind;副作用未运行时不发兜底请求", async () => {
    stubNavigator("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
    const mod: PlatformModule = await import("./platform");
    expect(mod.usePlatformKind()).toBe("macos");
    expect(mocks.platformKind).not.toHaveBeenCalled();
  });

  it("UA unknown 时兜底:认识 OS 回写状态并进缓存", async () => {
    stubNavigator("Mozilla/5.0 (SunOS)");
    mocks.platformKind.mockResolvedValue("windows");
    const mod: PlatformModule = await import("./platform");
    expect(mod.usePlatformKind()).toBe("unknown");

    mocks.mountEffect?.();
    /* 兜底结果回写渲染状态恰好一次,并进缓存供后续 getPlatformKind 命中 */
    await vi.waitFor(() => expect(mocks.setKind).toHaveBeenCalledTimes(1));
    expect(mocks.setKind).toHaveBeenCalledWith("windows");
    expect(mod.getPlatformKind()).toBe("windows");
  });

  it("Rust 侧不认识的 OS:状态与缓存都不动", async () => {
    stubNavigator(undefined);
    mocks.platformKind.mockResolvedValue("freebsd");
    const mod: PlatformModule = await import("./platform");
    mod.usePlatformKind();
    mocks.mountEffect?.();
    await vi.waitFor(() => expect(mocks.platformKind).toHaveBeenCalled());
    expect(mocks.setKind).not.toHaveBeenCalled();
    expect(mod.getPlatformKind()).toBe("unknown");
  });

  it("兜底请求失败被吞掉:不抛错、状态不动", async () => {
    stubNavigator(undefined);
    mocks.platformKind.mockRejectedValue(new Error("ipc down"));
    const mod: PlatformModule = await import("./platform");
    mod.usePlatformKind();
    expect(() => mocks.mountEffect?.()).not.toThrow();
    await vi.waitFor(() => expect(mocks.platformKind).toHaveBeenCalled());
    expect(mocks.setKind).not.toHaveBeenCalled();
    expect(mod.getPlatformKind()).toBe("unknown");
  });

  it("UA 已认识时挂载副作用不发兜底请求", async () => {
    stubNavigator("Mozilla/5.0 (Windows NT 10.0)");
    const mod: PlatformModule = await import("./platform");
    mod.usePlatformKind();
    mocks.mountEffect?.();
    expect(mocks.platformKind).not.toHaveBeenCalled();
    expect(mocks.setKind).not.toHaveBeenCalled();
  });
});

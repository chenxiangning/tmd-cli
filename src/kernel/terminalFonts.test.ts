/**
 * terminalFonts 契约:
 * resolveTerminalFontFamily —— 非空自定义串 trim 后原样优先;空白回落平台默认栈
 * (mac Menlo 系 / win Cascadia 系 / linux DejaVu 系 / unknown 裸 monospace)。
 * terminalFontOptionsForPlatform —— 按当前平台过滤:未限定 platforms 的跨平台项
 * 恒保留,平台专属只留给对应平台,unknown 只剩跨平台项;相对顺序保持。
 * isTerminalFontAvailable —— 取 family 首名剥引号探测;monospace/ui-monospace/空
 * 直接放行不探测;探测结果透传;探测环境异常视为可用(不置灰)。
 * platform 以可控桩替代,document.fonts 以最小桩替代。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const platformMock = vi.hoisted(() => ({ kind: "macos" as string }));
const fontsCheck = vi.hoisted(() => vi.fn());

vi.mock("./platform", () => ({ getPlatformKind: () => platformMock.kind }));

type TerminalFontsModule = typeof import("./terminalFonts");

beforeEach(() => {
  platformMock.kind = "macos";
  fontsCheck.mockReset();
  vi.stubGlobal("document", { fonts: { check: fontsCheck } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function load(): Promise<TerminalFontsModule> {
  return import("./terminalFonts");
}

describe("resolveTerminalFontFamily", () => {
  it("非空自定义串 trim 后原样优先", async () => {
    const mod = await load();
    expect(mod.resolveTerminalFontFamily("  'Fira Code', monospace  ")).toBe("'Fira Code', monospace");
  });

  it("空白自定义回落平台默认栈", async () => {
    const mod = await load();
    expect(mod.resolveTerminalFontFamily("")).toBe("Menlo, Monaco, 'Courier New', monospace");

    platformMock.kind = "windows";
    expect(mod.resolveTerminalFontFamily("   ")).toBe("'Cascadia Mono', Consolas, 'Courier New', monospace");

    platformMock.kind = "linux";
    expect(mod.resolveTerminalFontFamily("")).toBe("'DejaVu Sans Mono', 'Liberation Mono', monospace");

    platformMock.kind = "unknown";
    expect(mod.resolveTerminalFontFamily("")).toBe("monospace");
  });
});

describe("terminalFontOptionsForPlatform", () => {
  it("平台专属项只留给对应平台,跨平台项恒保留,顺序保持", async () => {
    const mod = await load();

    const mac = mod.terminalFontOptionsForPlatform().map((o) => o.label);
    expect(mac).toEqual([
      "Menlo", "Monaco", "SF Mono",
      "JetBrains Mono", "Fira Code", "Source Code Pro", "Iosevka", "Hack",
    ]);

    platformMock.kind = "linux";
    const linux = mod.terminalFontOptionsForPlatform().map((o) => o.label);
    expect(linux).toEqual([
      "DejaVu Sans Mono", "Liberation Mono", "Noto Sans Mono",
      "JetBrains Mono", "Fira Code", "Source Code Pro", "Iosevka", "Hack",
    ]);
  });

  it("unknown 平台只剩跨平台项", async () => {
    platformMock.kind = "unknown";
    const mod = await load();
    expect(mod.terminalFontOptionsForPlatform().map((o) => o.label)).toEqual([
      "JetBrains Mono", "Fira Code", "Source Code Pro", "Iosevka", "Hack",
    ]);
  });
});

describe("isTerminalFontAvailable", () => {
  it("取 family 首名剥引号后探测", async () => {
    const mod = await load();
    fontsCheck.mockReturnValue(true);
    expect(mod.isTerminalFontAvailable("'JetBrains Mono', monospace")).toBe(true);
    expect(fontsCheck).toHaveBeenCalledWith("12px JetBrains Mono");

    mod.isTerminalFontAvailable('"Fira Code", monospace');
    expect(fontsCheck).toHaveBeenLastCalledWith("12px Fira Code");
  });

  it("通用关键字与空串直接放行,不触发探测", async () => {
    const mod = await load();
    expect(mod.isTerminalFontAvailable("monospace")).toBe(true);
    expect(mod.isTerminalFontAvailable("ui-monospace, monospace")).toBe(true);
    expect(mod.isTerminalFontAvailable("")).toBe(true);
    expect(fontsCheck).not.toHaveBeenCalled();
  });

  it("探测结果透传;探测环境异常视为可用", async () => {
    const mod = await load();
    fontsCheck.mockReturnValue(false);
    expect(mod.isTerminalFontAvailable("Consolas, monospace")).toBe(false);

    fontsCheck.mockImplementation(() => {
      throw new Error("no fonts api");
    });
    expect(mod.isTerminalFontAvailable("Menlo, monospace")).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

/** 钉住分支语义:execCommand 手势内优先,假败回退 async clipboard,皆败才抛。 */
describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** 最小 document 桩:createElement 出可断言的 textarea,execCommand 可控。 */
  const stubDoc = (execRet: boolean) => {
    const ta = {
      value: "",
      style: {} as Record<string, string>,
      select: vi.fn(),
      remove: vi.fn(),
    };
    const execCommand = vi.fn(() => execRet);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ta),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    });
    return { ta, execCommand };
  };

  it("execCommand 成功时直接采用,不碰 async clipboard", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { ta, execCommand } = stubDoc(true);
    await copyText("hi");
    expect(ta.value).toBe("hi");
    expect(ta.select).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(ta.remove).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("execCommand 假败时回退 async clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    stubDoc(false);
    await copyText("hi");
    expect(writeText).toHaveBeenCalledWith("hi");
  });

  it("两者皆败才抛(调用方错误提示才真实)", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    stubDoc(false);
    await expect(copyText("hi")).rejects.toThrow("denied");
  });
});

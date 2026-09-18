/** lspRegistry 注册语义测试(路由函数不涉工作区模块,mock 掉)。 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@kernel/workspace", () => ({
  getWorkspaces: () => [],
  getActiveWorkspace: () => null,
}));

import { configForPath, languageServerConfigs, registerLanguageServer } from "./lspRegistry";

const offs: (() => void)[] = [];

function reg(language: string, extensions: readonly string[]) {
  const off = registerLanguageServer({ language, extensions, discover: async () => null });
  offs.push(off);
}

afterEach(() => {
  offs.splice(0).forEach((off) => off());
});

describe("registerLanguageServer", () => {
  it("注册后可按扩展名路由(大小写不敏感)", () => {
    reg("python", [".py"]);
    const cfg = configForPath("/w/a/b/Main.PY");
    expect(cfg?.language).toBe("python");
    expect(configForPath("/w/x.ts")).toBeNull();
    expect(configForPath("/w/noext")).toBeNull();
  });

  it("同 language 后注册替换;退订移除", () => {
    reg("java", [".java"]);
    reg("java", [".java"]);
    expect(languageServerConfigs().filter((c) => c.language === "java")).toHaveLength(1);
    offs.splice(0).forEach((off) => off());
    expect(languageServerConfigs().some((c) => c.language === "java")).toBe(false);
  });
});

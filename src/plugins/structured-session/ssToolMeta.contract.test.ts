/**
 * 工具行契约 —— ssToolMeta 纯函数:类型归类(codemoss toolTypeKey 规则)与
 * 文件 chip 提炼(glob/URL 不给,读选择器尾段剥除,Windows 盘符存活)。
 */

import { describe, expect, it } from "vitest";
import { fileChipFor, toolTypeKey } from "./ssToolMeta";

describe("toolTypeKey", () => {
  it("按工具名归位六类 + 兜底 tool", () => {
    expect(toolTypeKey("web_search")).toBe("web");
    expect(toolTypeKey("Bash")).toBe("shell");
    expect(toolTypeKey("read_file")).toBe("read");
    expect(toolTypeKey("apply_patch")).toBe("edit");
    expect(toolTypeKey("search_files")).toBe("search");
    expect(toolTypeKey("spawn_agent")).toBe("task");
    expect(toolTypeKey("mystery")).toBe("tool");
  });

  it("多词标签 = shell 命令(codemoss 判据)", () => {
    expect(toolTypeKey("git status")).toBe("shell");
    expect(toolTypeKey("pnpm check:gate")).toBe("shell");
  });
});

describe("fileChipFor", () => {
  it("常规路径取尾名,含读选择器剥尾段", () => {
    expect(fileChipFor("/repo/src/a.ts")).toBe("a.ts");
    expect(fileChipFor("C:\\proj\\b.rs")).toBe("b.rs");
    expect(fileChipFor("/repo/src/a.ts:301-591:raw")).toBe("a.ts");
    expect(fileChipFor("/repo/img.svg:img")).toBe("img.svg");
    expect(fileChipFor("C:/proj/b.rs")).toBe("b.rs");
  });

  it("glob / URL / 空路径不给 chip", () => {
    expect(fileChipFor("/repo/src/*.ts")).toBeNull();
    expect(fileChipFor("https://example.com/a.ts")).toBeNull();
    expect(fileChipFor("artifact://0")).toBeNull();
    expect(fileChipFor(null)).toBeNull();
    expect(fileChipFor("")).toBeNull();
  });

  it("Windows 带行号盘符存活", () => {
    expect(fileChipFor("C:/proj/b.rs:12")).toBe("b.rs");
  });
});

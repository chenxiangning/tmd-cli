/**
 * 抽屉条目展示名派生(displayName)—— 按 section 派生用户可见名:
 * 命令加 `/` 前缀、技能加 `$` 前缀(镜像 composer 触发符语义),
 * mcp/plugin 区无触发符语义、原样展示。
 * SECTION_META/SECTION_ORDER 为编译期 Record 全覆盖字面量,运行时无分支,不测。
 */
import { describe, expect, it } from "vitest";
import { displayName } from "./drawerSections";
import type { DrawerItem } from "../drawerItems";

function item(section: DrawerItem["section"], name: string): DrawerItem {
  return { section, name, action: "insert" };
}

describe("displayName 展示名派生", () => {
  it("命令条目带 / 前缀(与 composer 触发符一致)", () => {
    expect(displayName(item("command", "help"))).toBe("/help");
  });

  it("技能条目带 $ 前缀(与 composer 触发符一致)", () => {
    expect(displayName(item("skill", "think"))).toBe("$think");
  });

  it("mcp/plugin 条目原样展示,不加任何前缀", () => {
    expect(displayName(item("mcp", "filesystem"))).toBe("filesystem");
    expect(displayName(item("plugin", "文件树"))).toBe("文件树");
  });
});

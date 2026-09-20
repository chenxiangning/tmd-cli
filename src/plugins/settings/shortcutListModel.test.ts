/**
 * shortcutListModel 契约(快捷键 tab 纯模型):
 * groupCommandsByIdPrefix —— 按 id 首段前缀分组、组按首次出现顺序稳定排列、
 *   组内保序;映射表没有的前缀(含无点 id)回落「外壳与终端」组;
 * effectiveLabel —— 覆盖表优先(经 formatKeybinding 标签化)、空串覆盖 = 显式
 *   解绑返回 null;无覆盖回落 keybindingLabel > keybinding 格式化,全缺 null;
 * filterCommands —— 空查询(纯空白)原样返回同一引用;大小写不敏感匹配
 *   标题/id/键位标签(effective 标签,覆盖后新标签参与匹配);命中后空组丢弃、
 *   组间组内保序。
 * 手法:override 表是模块级单例,vi.resetModules + 动态 import 取全新实例;
 *   覆盖面用真 setShortcutOverrides 播种(走真实生效路径,不 mock)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContribution } from "@kernel/shortcuts";

type Mod = typeof import("./shortcutListModel");
type Overrides = typeof import("@kernel/shortcutOverrides");

let mod: Mod;
let overrides: Overrides;

beforeEach(async () => {
  vi.resetModules();
  // 动态 import 例外:被测模块读模块级单例 override 表,必须借 resetModules 取全新实例
  mod = await import("./shortcutListModel");
  overrides = await import("@kernel/shortcutOverrides");
});

const cmd = (id: string, extra: Partial<CommandContribution> = {}): CommandContribution => ({
  id,
  title: id,
  ...extra,
} as CommandContribution);

describe("groupCommandsByIdPrefix", () => {
  it("按 id 首段前缀分组,组按首次出现顺序排列,组内保序", () => {
    const groups = mod.groupCommandsByIdPrefix(
      [cmd("git.commit"), cmd("files.open"), cmd("git.push"), cmd("git.status")],
      new Map([
        ["git", "Git"],
        ["files", "文件"],
      ]),
    );
    expect(groups.map((g) => g.name)).toEqual(["Git", "文件"]);
    expect(groups[0].commands.map((c) => c.id)).toEqual(["git.commit", "git.push", "git.status"]);
    expect(groups[1].commands.map((c) => c.id)).toEqual(["files.open"]);
  });

  it("映射表没有的前缀(含无点 id)归入「外壳与终端」组", () => {
    const groups = mod.groupCommandsByIdPrefix(
      [cmd("orphan.do"), cmd("solo")],
      new Map<string, string>(),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("外壳与终端");
    expect(groups[0].commands.map((c) => c.id)).toEqual(["orphan.do", "solo"]);
  });
});

describe("effectiveLabel", () => {
  it("无覆盖时回落 keybindingLabel,缺省再由 keybinding 格式化,全缺返回 null", () => {
    expect(mod.effectiveLabel(cmd("a.b"))).toBeNull();
    expect(mod.effectiveLabel(cmd("a.b", { keybinding: "Cmd+Shift+E" }))).toBe("⌘⇧E");
    expect(
      mod.effectiveLabel(cmd("a.b", { keybinding: "Cmd+K", keybindingLabel: "⌘1-9" })),
    ).toBe("⌘1-9");
  });

  it("覆盖表优先于静态标签,值经 formatKeybinding 标签化", () => {
    overrides.setShortcutOverrides({ "a.b": "Cmd+K" });
    expect(
      mod.effectiveLabel(cmd("a.b", { keybinding: "Cmd+Shift+E", keybindingLabel: "⌘⇧E" })),
    ).toBe("⌘K");
  });

  it("空串覆盖 = 显式解绑,返回 null 而非回落默认键位", () => {
    overrides.setShortcutOverrides({ "a.b": "" });
    expect(mod.effectiveLabel(cmd("a.b", { keybinding: "Cmd+K" }))).toBeNull();
  });

  it("match 型恒显 keybindingLabel,陈旧 override 不遮蔽", () => {
    overrides.setShortcutOverrides({ "a.b": "Cmd+X", "a.c": "" });
    expect(
      mod.effectiveLabel(cmd("a.b", { match: () => true, keybindingLabel: "⌘1-9" })),
    ).toBe("⌘1-9");
    expect(mod.effectiveLabel(cmd("a.c", { match: () => true, keybindingLabel: "Ctrl+Tab" }))).toBe("Ctrl+Tab");
  });
});

describe("filterCommands", () => {
  const groups = () => [
    {
      name: "Git",
      commands: [
        cmd("git.commit", { title: "提交" }),
        cmd("git.push", { title: "推送", keybinding: "Cmd+Shift+E" }),
      ],
    },
    { name: "文件", commands: [cmd("FILES.OPEN", { title: "打开文件" })] },
    { name: "主题", commands: [cmd("theme.switch", { title: "切换主题" })] },
  ];

  it("空查询(含纯空白)原样返回同一引用", () => {
    const g = groups();
    expect(mod.filterCommands(g, "")).toBe(g);
    expect(mod.filterCommands(g, "   ")).toBe(g);
  });

  it("标题/id/键位标签大小写不敏感命中;无命中的组整组丢弃,组间组内保序", () => {
    const byTitle = mod.filterCommands(groups(), "推");
    expect(byTitle.map((g) => g.name)).toEqual(["Git"]);
    expect(byTitle[0].commands.map((c) => c.id)).toEqual(["git.push"]);

    const byId = mod.filterCommands(groups(), "files.open");
    expect(byId.map((g) => g.name)).toEqual(["文件"]);
    expect(byId[0].commands.map((c) => c.id)).toEqual(["FILES.OPEN"]);

    const byLabel = mod.filterCommands(groups(), "⇧e");
    expect(byLabel[0].commands.map((c) => c.id)).toEqual(["git.push"]);
  });

  it("过滤走 effective 键位:覆盖后的新标签参与匹配", () => {
    overrides.setShortcutOverrides({ "git.commit": "Cmd+Z" });
    const out = mod.filterCommands(groups(), "⌘z");
    expect(out.map((g) => g.name)).toEqual(["Git"]);
    expect(out[0].commands.map((c) => c.id)).toEqual(["git.commit"]);
  });
});

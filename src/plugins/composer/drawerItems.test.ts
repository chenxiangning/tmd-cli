/**
 * drawerItems 单测 —— 静态/动态来源、null 回退、TTL 缓存、分区派生、缺省值。
 * 全部走纯数据 profile,不激活任何真实插件(host 仅被 import,不被调用)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDrawerItemsCache,
  declaredSections,
  resolveProfileDrawerItems,
  type DrawerItem,
} from "./drawerItems";
import type { CliProfile } from "@kernel/cli";

function makeProfile(overrides: Partial<CliProfile> = {}): CliProfile {
  return {
    id: "test-cli",
    name: "test",
    command: "test",
    args: [],
    triggers: [
      { char: "/", kind: "command" },
      { char: "$", kind: "skill" },
    ],
    suggestions: {
      command: [
        { value: "clear", description: "清屏", action: "send" },
        { value: "model", description: "切换模型" },
      ],
      skill: [{ value: "plan", description: "规划" }],
    },
    ...overrides,
  };
}

function names(items: DrawerItem[]): string[] {
  return items.map((i) => `${i.section}:${i.name}`);
}

describe("resolveProfileDrawerItems", () => {
  beforeEach(() => {
    clearDrawerItemsCache();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("静态表:action 缺省 insert,命令/技能 token 按触发符合成", async () => {
    const items = await resolveProfileDrawerItems(makeProfile(), "/w");
    expect(names(items)).toEqual(["command:clear", "command:model", "skill:plan"]);
    expect(items[0].action).toBe("send"); // 显式声明
    expect(items[1].action).toBe("insert"); // 缺省兜底
    expect(items[1].token).toBe("/model ");
    expect(items[2].token).toBe("$plan ");
  });

  it("分区派生:未声明 $ 触发符的 profile 不出技能区(候选存在也不出)", async () => {
    const p = makeProfile({
      triggers: [{ char: "/", kind: "command" }],
    });
    const items = await resolveProfileDrawerItems(p, "/w");
    expect(names(items)).toEqual(["command:clear", "command:model"]);
  });

  it("token 覆盖默认合成(order 参与排序)", async () => {
    const p = makeProfile({
      suggestions: {
        command: [
          { value: "a", order: 2 },
          { value: "b", order: 1, token: "/b-now " },
        ],
      },
    });
    const items = await resolveProfileDrawerItems(p, "/w");
    expect(names(items)).toEqual(["command:b", "command:a"]);
    expect(items[0].token).toBe("/b-now ");
    expect(items[1].token).toBe("/a ");
  });

  it("provider 按 kind 分别调用;动态与静态按 value 合并,静态 action 保留", async () => {
    const provider = vi.fn().mockResolvedValue([
      { value: "dynamic-cmd", action: "send" },
      { value: "clear" }, // 与静态撞名 → 丢弃,静态条目(带 icon/action)保留
    ]);
    const p = makeProfile({ listSuggestions: provider });
    const items = await resolveProfileDrawerItems(p, "/w");
    expect(names(items)).toContain("command:dynamic-cmd");
    expect(names(items)).toContain("skill:dynamic-cmd"); // 同一 provider 喂两个 kind
    expect(names(items)).toContain("command:clear"); // 静态内置仍在前
    expect(items.filter((i) => i.section === "command" && i.name === "clear")).toHaveLength(1); // 分区内去重,静态保留
    expect(provider).toHaveBeenCalledTimes(2); // command / skill 各一次
  });

  it("provider 返回 null 或 reject → 回退静态表,且失败不缓存", async () => {
    const provider = vi
      .fn()
      .mockRejectedValueOnce(new Error("io"))
      .mockResolvedValueOnce(null)
      .mockResolvedValue([{ value: "ok" }]);
    const p = makeProfile({ listSuggestions: provider, triggers: [{ char: "/", kind: "command" }] });
    const first = await resolveProfileDrawerItems(p, "/w");
    expect(names(first)).toContain("command:clear"); // 回退静态
    const second = await resolveProfileDrawerItems(p, "/w");
    expect(names(second)).toContain("command:clear"); // null 同样回退
    const third = await resolveProfileDrawerItems(p, "/w");
    expect(names(third)).toContain("command:ok"); // 失败/null 未缓存,本次成功
  });

  it("TTL 缓存:60s 内 provider 只调一次,过期后重调", async () => {
    const provider = vi.fn().mockResolvedValue([{ value: "x" }]);
    const p = makeProfile({ listSuggestions: provider, triggers: [{ char: "/", kind: "command" }] });
    await resolveProfileDrawerItems(p, "/w");
    await resolveProfileDrawerItems(p, "/w");
    expect(provider).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(60_001);
    await resolveProfileDrawerItems(p, "/w");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("缓存 key 含 profileId/kind/cwd:不同 cwd 互不命中", async () => {
    const provider = vi.fn().mockResolvedValue([{ value: "x" }]);
    const p = makeProfile({ listMcpServers: provider });
    await resolveProfileDrawerItems(p, "/a");
    await resolveProfileDrawerItems(p, "/b");
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("mcp:未声明 listMcpServers = 无此区;声明后默认 token 为 $mention", async () => {
    const none = await resolveProfileDrawerItems(makeProfile(), "/w");
    expect(names(none)).not.toContain("mcp:any");

    const p = makeProfile({
      listMcpServers: vi
        .fn()
        .mockResolvedValue([{ value: "github", description: "MCP", token: "$github " }]),
    });
    const items = await resolveProfileDrawerItems(p, "/w");
    const mcp = items.find((i) => i.section === "mcp");
    expect(mcp?.name).toBe("github");
    expect(mcp?.token).toBe("$github ");
    expect(mcp?.action).toBe("insert");
  });

  it("declaredSections:命令/技能按 triggers,mcp 按 listMcpServers 声明", () => {
    expect(declaredSections(makeProfile())).toEqual(["command", "skill"]);
    expect(
      declaredSections(makeProfile({ listMcpServers: () => Promise.resolve([]) })),
    ).toEqual(["command", "skill", "mcp"]);
    expect(declaredSections(makeProfile({ triggers: [{ char: "/", kind: "command" }] }))).toEqual([
      "command",
    ]);
  });
});

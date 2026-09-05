/**
 * opencode 配置解析纯函数单测 —— 合并语义与候选派生契约守卫。
 */
import { describe, expect, it } from "vitest";
import {
  mergeOpencodeConfig,
  opencodeDefaultModel,
  opencodeJsonCommandSuggestions,
  opencodeMcpSuggestions,
  type OpencodeConfig,
} from "./config";

describe("mergeOpencodeConfig(全局 + 项目合并)", () => {
  it("标量项目覆盖全局;mcp/command 按键合并", () => {
    const global: OpencodeConfig = {
      model: "zhipuai-coding-plan/glm-5.2",
      mcp: { pencil: { type: "local", enabled: true }, keep: { type: "remote" } },
      command: { old: { template: "x" } },
    };
    const project: OpencodeConfig = {
      model: "minimax-cn-coding-plan/MiniMax-M2",
      mcp: { pencil: { type: "local", enabled: false } },
    };
    const merged = mergeOpencodeConfig(global, project);
    expect(merged.model).toBe("minimax-cn-coding-plan/MiniMax-M2");
    expect(merged.mcp).toEqual({
      keep: { type: "remote" },
      pencil: { type: "local", enabled: false },
    });
    expect(merged.command).toEqual({ old: { template: "x" } });
  });

  it("任一端为 null 仍成立;双 null = 空配置", () => {
    expect(mergeOpencodeConfig({ model: "a/b" }, null).model).toBe("a/b");
    expect(mergeOpencodeConfig(null, { model: "c/d" }).model).toBe("c/d");
    expect(mergeOpencodeConfig(null, null)).toEqual({});
  });
});

describe("opencodeDefaultModel", () => {
  it("model 字段透传;缺失/空串 = null", () => {
    expect(opencodeDefaultModel({ model: "openai/gpt-5" })).toBe("openai/gpt-5");
    expect(opencodeDefaultModel({})).toBeNull();
    expect(opencodeDefaultModel({ model: "" })).toBeNull();
    expect(opencodeDefaultModel(null)).toBeNull();
  });
});

describe("opencodeMcpSuggestions(mcp 表 → MCP 分区候选)", () => {
  it("名字 + 类型描述;enabled=false 标注停用;缺 type 回退 local", () => {
    const items = opencodeMcpSuggestions({
      mcp: {
        pencil: { type: "local", enabled: true },
        remoteDb: { type: "remote" },
        off: { enabled: false },
      },
    });
    expect(items).toEqual([
      { value: "pencil", description: "MCP local", action: "insert", icon: "server" },
      { value: "remoteDb", description: "MCP remote", action: "insert", icon: "server" },
      { value: "off", description: "MCP local · 已停用", action: "insert", icon: "server" },
    ]);
  });
  it("无 mcp 表 = 空表(调用方按无分区降级)", () => {
    expect(opencodeMcpSuggestions(null)).toEqual([]);
    expect(opencodeMcpSuggestions({ mcp: "异型" } as unknown as OpencodeConfig)).toEqual([]);
  });
});

describe("opencodeJsonCommandSuggestions(command 表 → 命令候选)", () => {
  it("template 必填缺失跳过;description 透传", () => {
    expect(
      opencodeJsonCommandSuggestions({
        command: {
          review: { template: "审查 $ARGUMENTS", description: "代码审查" },
          broken: { description: "缺 template" },
        },
      }),
    ).toEqual([{ value: "review", description: "代码审查", action: "insert" }]);
  });
  it("无 command 表 = 空表", () => {
    expect(opencodeJsonCommandSuggestions(null)).toEqual([]);
  });
});

/**
 * opencode 配置解析纯函数单测 —— 合并语义与候选派生契约守卫。
 */
import { describe, expect, it } from "vitest";
import {
  mergeOpencodeConfig,
  opencodeDefaultModel,
  opencodeJsonCommandSuggestions,
  type OpencodeConfig,
} from "./config";

describe("mergeOpencodeConfig(全局 + 项目合并)", () => {
  it("标量项目覆盖全局;command 映射按键合并", () => {
    const global: OpencodeConfig = {
      model: "zhipuai-coding-plan/glm-5.2",
      command: { old: { template: "x" }, shared: { template: "全局版" } },
    };
    const project: OpencodeConfig = {
      model: "minimax-cn-coding-plan/MiniMax-M2",
      command: { shared: { template: "项目版" } },
    };
    const merged = mergeOpencodeConfig(global, project);
    expect(merged.model).toBe("minimax-cn-coding-plan/MiniMax-M2");
    expect(merged.command).toEqual({
      old: { template: "x" },
      shared: { template: "项目版" },
    });
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

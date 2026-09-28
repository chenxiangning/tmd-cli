/**
 * 转录分组模型测试 —— 阶段切分/思考摘要/组标题/工具行标签(monocode 同款规则)。
 */

import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import {
  buildTranscriptPhases,
  phaseTitle,
  proseSummary,
  toolRowLabel,
} from "./transcriptPhases";

function block(id: string, role: CliTranscriptBlock["role"], text: string, tool?: CliTranscriptBlock["tool"]): CliTranscriptBlock {
  return { id, role, text, ...(tool ? { tool } : {}) };
}

describe("proseSummary", () => {
  it("取首段,去 MD 标记与 code fence,折叠空白", () => {
    expect(proseSummary("**加粗** 与 `code` 混合\n\n第二段")).toBe("加粗 与 code 混合");
    expect(proseSummary("```js\nconst a=1\n```\n之后的正文")).toBe("之后的正文");
    expect(proseSummary("- 列表项\n继续")).toBe("列表项 继续");
  });
});

describe("buildTranscriptPhases", () => {
  it("user 是组边界;assistant 开组;reasoning/tool 归组;kind 随工具变", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "帮我修"),
      block("a1", "assistant", "我来看下结构"),
      block("r1", "reasoning", "先看目录"),
      block("t1", "tool", "", { title: "Edit", status: "done", preview: { kind: "write", path: "/x/a.ts" } }),
      block("a2", "assistant", "改好了"),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["user", "phase", "phase"]);
    const phases = out.filter(
      (i): i is Extract<typeof i, { kind: "phase" }> => i.kind === "phase",
    );
    const [p1, p2] = phases;
    expect(p1.phase.headline?.id).toBe("a1");
    expect(p1.phase.steps.map((s) => s.id)).toEqual(["r1", "t1"]);
    expect(p1.phase.kind).toBe("change");
    expect(p2.phase.headline?.id).toBe("a2");
  });

  it("孤立思考/工具(无前置 assistant)开 think/run 组", () => {
    const out = buildTranscriptPhases([
      block("r1", "reasoning", "想想"),
      block("s1", "tool", "", { title: "bash", status: "done", preview: { kind: "shell", output: "ls" } }),
    ]);
    const phases = out.filter(
      (i): i is Extract<typeof i, { kind: "phase" }> => i.kind === "phase",
    );
    expect(phases).toHaveLength(1);
    expect(phases[0].phase.kind).toBe("run");
    expect(phaseTitle(phases[0].phase)).toContain("bash");
  });
});

describe("toolRowLabel", () => {
  it("write 类:动词 + 文件名;shell 类:命令首行", () => {
    expect(
      toolRowLabel(block("t1", "tool", "", { title: "Edit", preview: { kind: "write", path: "/x/src/a.ts" } })),
    ).toBe("Edit  a.ts");
    expect(
      toolRowLabel(block("t2", "tool", "", { title: "bash", preview: { kind: "shell", output: "git status\n分支" } })),
    ).toBe("bash  git status");
  });
});

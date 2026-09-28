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
  const long = (id: string, text: string) =>
    block(id, "assistant", text + "结".repeat(400));

  it("user 是组边界;大段 assistant 开组 headline;reasoning/tool 归组;kind 随工具变", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "帮我修"),
      long("a1", "结论:"),
      block("r1", "reasoning", "先看目录"),
      block("t1", "tool", "", { title: "Edit", status: "done", preview: { kind: "write", path: "/x/a.ts" } }),
      long("a2", "总结:"),
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

  it("思考链短语不开组,归入当前组随组默认折叠", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "开工"),
      block("a1", "assistant", "§628 开工。恢复任务清单,盯成两处并环发现"),
      block("t1", "tool", "", { title: "bash", status: "done", preview: { kind: "shell", output: "pnpm typecheck" } }),
      block("a2", "assistant", "§645 跑通了,继续下一处"),
    ]);
    const phases = out.filter(
      (i): i is Extract<typeof i, { kind: "phase" }> => i.kind === "phase",
    );
    expect(phases).toHaveLength(1);
    expect(phases[0].phase.headline).toBeUndefined();
    expect(phases[0].phase.steps.map((s) => s.id)).toEqual(["a1", "t1", "a2"]);
    expect(phases[0].phase.kind).toBe("run");
    expect(phaseTitle(phases[0].phase)).toContain("bash");
  });

  it("headline 后的短语归该组,不再切新组", () => {
    const out = buildTranscriptPhases([
      long("a1", "方案如下:"),
      block("a2", "assistant", "先改内核再补用例"),
      block("t1", "tool", "", { title: "Edit", status: "done", preview: { kind: "write", path: "/x/a.ts" } }),
    ]);
    expect(out).toHaveLength(1);
    const phase = (
      out.filter((i): i is Extract<typeof i, { kind: "phase" }> => i.kind === "phase")[0]
    ).phase;
    expect(phase.headline?.id).toBe("a1");
    expect(phase.steps.map((s) => s.id)).toEqual(["a2", "t1"]);
  });

  it("纯问答轮(整轮只有 assistant 短语)还原全尺寸,不折叠", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "这文件多大?"),
      block("a1", "assistant", "3KB,上次改于昨天"),
      block("u2", "user", "好"),
      block("a2", "assistant", "No response requested."),
    ]);
    const phases = out.filter(
      (i): i is Extract<typeof i, { kind: "phase" }> => i.kind === "phase",
    );
    /* 每条短语各自成 headline 组(步骤空 → 不渲染折叠组,即全尺寸正文)。 */
    expect(phases.map((p) => p.phase.headline?.id)).toEqual(["a1", "a2"]);
    expect(phases.every((p) => p.phase.steps.length === 0)).toBe(true);
  });

  it("短语 + 思考混排仍是工作组(有 reasoning 则折叠,不还原)", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "分析下"),
      block("a1", "assistant", "先看结构"),
      block("r1", "reasoning", "目录里有…"),
    ]);
    const phases = out.filter(
      (i): i is Extract<typeof i, { kind: "phase" }> => i.kind === "phase",
    );
    expect(phases).toHaveLength(1);
    expect(phases[0].phase.headline).toBeUndefined();
    expect(phases[0].phase.steps.map((s) => s.id)).toEqual(["a1", "r1"]);
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

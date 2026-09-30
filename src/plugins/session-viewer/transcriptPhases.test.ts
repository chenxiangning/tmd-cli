/**
 * 转录分组模型测试 —— 阶段切分(正文永不折叠)/思考摘要/组标题/工具行标签。
 */

import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import {
  buildTranscriptPhases,
  phaseTitle,
  proseSummary,
  toolRowLabel,
  type TranscriptItem,
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
  const phasesOf = (out: TranscriptItem[]) =>
    out.filter(
      (i): i is Extract<TranscriptItem, { kind: "phase" }> => i.kind === "phase",
    );

  it("user 是组边界;正文上方过程收组,正文自身全尺寸独立", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "帮我修"),
      block("a1", "assistant", "结论:"),
      block("r1", "reasoning", "先看目录"),
      block("t1", "tool", "", { title: "Edit", status: "done", preview: { kind: "write", path: "/x/a.ts" } }),
      block("a2", "assistant", "总结:"),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["user", "assistant", "phase", "assistant"]);
    const [g] = phasesOf(out);
    expect(g.phase.steps.map((s) => s.id)).toEqual(["r1", "t1"]);
    expect(g.phase.kind).toBe("change");
  });

  it("短答复正文不进思考折叠(omp「在不在」回归):思考收组,正文全尺寸", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "在不在"),
      block("r1", "reasoning", "The user is just checking if I'm here — …"),
      block("a1", "assistant", "在。有什么要干的直接说。"),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["user", "phase", "assistant"]);
    const [g] = phasesOf(out);
    expect(g.phase.kind).toBe("think");
    expect(g.phase.steps.map((s) => s.id)).toEqual(["r1"]);
    expect(phaseTitle(g.phase)).toBe("思考");
  });

  it("轮中叙述短语不再入组:短语全尺寸,过程各自收组", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "开工"),
      block("a1", "assistant", "§628 开工。恢复任务清单,盯成两处并环发现"),
      block("t1", "tool", "", { title: "bash", status: "done", preview: { kind: "shell", output: "pnpm typecheck" } }),
      block("a2", "assistant", "§645 跑通了,继续下一处"),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["user", "assistant", "phase", "assistant"]);
    const [g] = phasesOf(out);
    expect(g.phase.steps.map((s) => s.id)).toEqual(["t1"]);
    expect(g.phase.kind).toBe("run");
    expect(phaseTitle(g.phase)).toContain("bash");
  });

  it("纯问答轮逐条全尺寸,无折叠组;空 assistant 块跳过", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "这文件多大?"),
      block("a1", "assistant", "3KB,上次改于昨天"),
      block("a0", "assistant", "  "),
      block("u2", "user", "好"),
      block("a2", "assistant", "No response requested."),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("正文后的孤立思考收新组,不并进正文", () => {
    const out = buildTranscriptPhases([
      block("u1", "user", "分析下"),
      block("a1", "assistant", "先看结构"),
      block("r1", "reasoning", "目录里有…"),
    ]);
    expect(out.map((i) => i.kind)).toEqual(["user", "assistant", "phase"]);
    const [g] = phasesOf(out);
    expect(g.phase.steps.map((s) => s.id)).toEqual(["r1"]);
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

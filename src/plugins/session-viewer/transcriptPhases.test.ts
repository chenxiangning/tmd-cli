/**
 * 转录共享纯函数测试 —— 工具行标签 / 运行输出尾窗钳制。
 * (旧 phase 分组模型用例随旧渲染删除,2026-11-05 渲染对齐。)
 */

import { describe, expect, it } from "vitest";
import type { CliTranscriptBlock } from "@kernel/cli";
import { tailLines, toolRowLabel } from "./transcriptPhases";

function block(id: string, role: CliTranscriptBlock["role"], text: string, tool?: CliTranscriptBlock["tool"]): CliTranscriptBlock {
  return { id, role, text, ...(tool ? { tool } : {}) };
}

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

describe("tailLines 运行中输出尾窗钳制", () => {
  it("超限只留末 N 行,不足整段直通", () => {
    const detail = Array.from({ length: 60 }, (_, i) => `L${i}`).join("\n");
    expect(tailLines(detail, 40)).not.toContain("L0\n");
    expect(tailLines(detail, 40)).toContain("L59");
    expect(tailLines("a\nb", 40)).toBe("a\nb");
  });
});

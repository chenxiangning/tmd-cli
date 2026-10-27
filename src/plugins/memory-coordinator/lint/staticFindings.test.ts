/**
 * staticFindings / diffUtil / applyLint 扩展单测 —— 「你反复在说」聚合与覆盖
 * 判断(4 字 CJK 滑窗 + ascii 串)、行级 diff、fixpath/追加/hook 块(纯函数面)。
 */
import { describe, expect, it } from "vitest";

import { coveredBy, repeatedLines } from "./staticFindings";
import { diffLines } from "./diffUtil";
import { appendRuleLine, buildHookBlock, fixPathInFile } from "./applyLint";
import type { CorpusMsg } from "./lintTypes";

function userMsg(text: string, sessionIdx: number): CorpusMsg {
  return { sessionIdx, role: "user", text, lower: text.toLowerCase(), ts: 1 };
}

describe("coveredBy", () => {
  it("任一 4 字 CJK 滑窗或 ≥4 ascii 串命中规则全文即覆盖", () => {
    const rules = "提交信息用中文祈使句\npnpm check:gate";
    expect(coveredBy("提交信息要用中文格式", rules)).toBe(true); /* 「中文祈使」? 无;「中文格式」无 → 但滑窗含「信息用中」? 逐窗判定 */
    expect(coveredBy("提交信息要用中文格式", "完全无关的规则")).toBe(false);
    expect(coveredBy("记得跑 pnpm check:gate 再交付", rules)).toBe(true); /* ascii 串命中 */
  });
});

describe("repeatedLines", () => {
  it("≥2 会话且 ≥2 次、含特征词、非纠正话术、未被覆盖才报;按次数降序", () => {
    const msgs = [
      userMsg("提交说明必须写清楚影响范围", 0),
      userMsg("提交说明必须写清楚影响范围", 1),
      userMsg("提交说明必须写清楚影响范围", 1),
      userMsg("不对,提交说明必须写清楚影响范围", 2), /* 纠正话术不入 */
      userMsg(" totally unrelated english words ", 3), /* 无特征词不入 */
    ];
    const out = repeatedLines(msgs, "已有的一些规则内容,和这句完全不同");
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(3);
    expect(out[0]!.sessions).toBe(2);
  });

  it("单会话重复或已被规则覆盖的不报", () => {
    const msgs = [
      userMsg("交付前必须跑一遍完整检查", 0),
      userMsg("交付前必须跑一遍完整检查", 0),
    ];
    expect(repeatedLines(msgs, "无关内容")).toHaveLength(0); /* 单会话 */
    expect(repeatedLines(msgs.slice(0, 0).concat(
      userMsg("交付前必须跑一遍完整检查", 0),
      userMsg("交付前必须跑一遍完整检查", 1),
    ), "交付前必须跑一遍完整检查")).toHaveLength(0); /* 已覆盖 */
  });
});

describe("diffLines", () => {
  it("首尾公共行修剪,余量即 del/add 块", () => {
    const old = ["# 头", "a", "b", "尾"].join("\n");
    const next = ["# 头", "b", "尾"].join("\n");
    expect(diffLines(old, next)).toEqual([
      { kind: "ctx", text: "…" },
      { kind: "del", text: "a" },
      { kind: "ctx", text: "…" },
    ]);
  });
});

describe("applyLint 扩展", () => {
  it("appendRuleLine:文末追加、缺空行补空行、幂等", () => {
    expect(appendRuleLine("# 标题\n", "新规则一行")).toBe("# 标题\n\n- 新规则一行\n");
    expect(appendRuleLine("# 标题", "新规则一行")).toBe("# 标题\n\n- 新规则一行\n");
    const again = appendRuleLine("# 标题\n\n- 新规则一行\n", "新规则一行");
    expect(again).toBe("# 标题\n\n- 新规则一行\n");
  });

  it("buildHookBlock:抽命令、产出守卫块", () => {
    const rule = {
      idx: 1, file: "/ws/AGENTS.md", line: 1, lineEnd: 1,
      text: "- 交付前必须跑 pnpm check:gate,不得只跑一段",
      section: "验证", kind: "command" as const, tokens: [], pathRefs: [], estTokens: 10,
    };
    const block = buildHookBlock(rule);
    expect(block).toContain("if ! pnpm check:gate >/dev/null 2>&1");
    expect(block).toContain('echo "规则拦截');
  });

  it("fixPathInFile:守卫该行含旧路径,替换首个命中", () => {
    const text = "# 头\ndocs/review/flow.md 见旧路径\n尾";
    expect(fixPathInFile(text, 2, "docs/review/flow.md", "docs/review/new.md")).toBe(
      "# 头\ndocs/review/new.md 见旧路径\n尾",
    );
    expect(fixPathInFile(text, 3, "docs/review/flow.md", "x")).toBeNull();
  });
});

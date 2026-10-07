/** 转录压缩原语契约:三角色单行化/丢弃面/预算截断/末条助手结论保底。 */
import { describe, expect, it } from "vitest";
import { capLine, renderTranscriptDigest, DIGEST_CAPS, type DigestCaps } from "./transcriptDigest";
import type { CliTranscriptBlock, CliTranscriptToolMeta } from "./cli";

const block = (
  role: CliTranscriptBlock["role"],
  text: string,
  tool?: CliTranscriptToolMeta,
): CliTranscriptBlock => ({ id: Math.random().toString(36).slice(2), role, text, ...(tool ? { tool } : {}) });

const caps: DigestCaps = { user: 50, assistant: 40, tool: 30, session: 120 };

describe("capLine", () => {
  it("空白折叠单行化 + 保头截断标记", () => {
    expect(capLine("a\n\n  b\tc  ", 50)).toBe("a b c");
    expect(capLine("甲".repeat(60), 50)).toBe(`甲`.repeat(50) + "…(截断)");
  });

  it("截断不劈开代理对(emoji 截点回退一位,不产孤立高代理)", () => {
    /* 1 个 BMP 字 + N 个 emoji(各 2 码元):截点必落在代理对中间。 */
    const cut = capLine("字" + "😀".repeat(40), 21);
    expect(cut).toBe(`字${"😀".repeat(10)}…(截断)`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(cut)).toBe(false);
  });
});

describe("renderTranscriptDigest", () => {
  it("user/assistant 保留、reasoning/system 丢弃、tool 压单行", () => {
    const digest = renderTranscriptDigest(
      [
        block("user", "看下竞态"),
        block("reasoning", "内部推理"),
        block("system", "环境注入"),
        block("assistant", "根因是共享 store 未做时序闸"),
        block("tool", "跑测试", { title: "vitest run", status: "ok" }),
      ],
      caps,
    );
    expect(digest).not.toBeNull();
    expect(digest!.lines).toEqual([
      "用户:看下竞态",
      "助手:根因是共享 store 未做时序闸",
      "动作:vitest run",
    ]);
    expect(digest!.truncated).toBe(false);
  });

  it("工具报错升格「报错」行并附 detail(error/failed 两词表)", () => {
    for (const status of ["error", "failed"] as const) {
      const digest = renderTranscriptDigest(
        [block("tool", "x", { title: "跑构建", status, detail: "link failed" })],
        caps,
      );
      expect(digest!.lines[0]).toBe("报错:跑构建 — link failed");
    }
  });

  it("超会话预算:截断标注 + 末条助手结论保底(不与已收行重复)", () => {
    const digest = renderTranscriptDigest(
      [
        block("user", "甲".repeat(50)),
        block("user", "乙".repeat(50)),
        block("assistant", "中途结论"),
        block("user", "丙".repeat(50)),
        block("assistant", "真正末条结论"),
      ],
      caps,
    );
    expect(digest!.truncated).toBe(true);
    expect(digest!.lines.at(-2)).toBe("助手(结尾):真正末条结论");
    expect(digest!.lines.at(-1)).toBe("(摘录超预算,后续内容省略)");
    /* 末条结论若已在预算内成行,不重复追加保底行 */
    const fresh = renderTranscriptDigest([block("assistant", "唯一结论")], caps);
    expect(fresh!.lines).toEqual(["助手:唯一结论"]);
  });

  it("无内容块返回 null(调用方按仅标题/占位处理)", () => {
    expect(renderTranscriptDigest([], caps)).toBeNull();
    expect(renderTranscriptDigest([block("system", "env")], caps)).toBeNull();
  });

  it("默认预算常量在位(摘录层与接力层各自透传消费)", () => {
    expect(DIGEST_CAPS).toEqual({ user: 800, assistant: 600, tool: 160, session: 4000 });
  });
});

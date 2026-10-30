/** 规则行处理闭环契约:已应用行必须有标识、动作按钮收口、拍板簇改述;未应用行按钮照常。 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuleRow } from "./LintRows";
import type { LintRow, RuleEvidence } from "./lintTypes";

const ev: RuleEvidence = {
  hits: 0, activeSessions: 0, lastSeen: 0, touchQuote: "", corrections: 0,
  correctionWords: [], correctionQuotes: [], complied: 0, complyQuote: "",
  discTokens: [], unjudgeable: false, command: "",
};
const rowOf = (p: Partial<LintRow>): LintRow => ({
  rule: { idx: 1, file: "/ws/AGENTS.md", line: 6, lineEnd: 6, text: "核心宗旨:拒绝平庸", section: "", kind: "style", tokens: [], pathRefs: [], estTokens: 12 },
  scope: "global",
  evidence: ev,
  judgment: { verdict: "unverifiable", reason: "词面不可用", advice: "keep", fix: "- 改写后的可执行规则" },
  settled: false,
  ...p,
});
const noop = () => {};

describe("RuleRow 处理闭环", () => {
  it("已应用行:绿徽标+已应用述语,改写/建议/钩子按钮全收口,保留打开与重开", () => {
    const html = renderToStaticMarkup(
      <RuleRow row={rowOf({ applied: true, settled: true })} busy={false} onApply={noop} onKeep={noop} onHook={noop} onReopen={noop} onRewrite={noop} />,
    );
    expect(html).toContain("已应用");
    expect(html).toContain("已应用:文件已更新,撤销走「应用记录」");
    expect(html).not.toContain("应用 AI 建议");
    expect(html).not.toContain("按建议处理");
    expect(html).not.toContain("上 pre-commit");
    expect(html).toContain("重开");
  });

  it("未应用行:按钮在,无已应用徽标", () => {
    const html = renderToStaticMarkup(
      <RuleRow row={rowOf({})} busy={false} onApply={noop} onKeep={noop} onHook={noop} onReopen={noop} onRewrite={noop} />,
    );
    expect(html).toContain("应用 AI 建议");
    expect(html).not.toContain(">已应用<");
  });

  it("仅拍板未应用:沿用已拍板述语,无绿徽标", () => {
    const html = renderToStaticMarkup(
      <RuleRow row={rowOf({ settled: true })} busy={false} onApply={noop} onKeep={noop} onHook={noop} onReopen={noop} onRewrite={noop} />,
    );
    expect(html).toContain("已拍板:此前处理过,不再重复报");
    expect(html).not.toContain("已应用:文件已更新");
  });
});

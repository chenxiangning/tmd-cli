/** 右栏运行幕布状态契约:运行/失败/完成不得混显。 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PtyCurtain } from "./LintCurtain";
import type { LintProgress } from "./lintModel";

const progress: LintProgress = { step: "judge", detail: "", done: 2, total: 8, waitSec: 6 };
const base = { progress, title: "omp · default", log: [], error: "" };

describe("PtyCurtain 运行状态", () => {
  it("运行中展示真实判定计数与 busy 语义", () => {
    const html = renderToStaticMarkup(<PtyCurtain {...base} running />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("运行中");
    expect(html).toContain("AI 判定中 2/8");
    expect(html).not.toContain("体检完成");
  });

  it("失败后不得误显体检完成", () => {
    const html = renderToStaticMarkup(<PtyCurtain {...base} running={false} error="engine failed" />);
    expect(html).toContain("体检失败");
    expect(html).not.toContain("体检完成");
    expect(html).toContain('aria-busy="false"');
  });

  it("正常结束展示完成态并发布状态通知", () => {
    const html = renderToStaticMarkup(<PtyCurtain {...base} running={false} />);
    expect(html).toContain("体检完成");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("体检失败");
  });
});

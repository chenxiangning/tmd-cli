/**
 * resolvePullExplanation 契约:解释文案随 (strategy, noCommit, noVerify) 组合
 * 逐字变化 —— 这是拉取对话框的「行为承诺」面,错一处就是向用户承诺错 git 行为。
 * 守住:default 行加粗标签 / 追加行的 tone 矩阵 / Will NOT 随策略切换。
 */

import { describe, expect, it } from "vitest";
import { resolvePullExplanation, type PullStrategy } from "./pullExplain";

const P = { remote: "origin", targetBranch: "main" };

describe("resolvePullExplanation", () => {
  it("default:第一行为按 Git 配置执行,Will NOT 不承诺合并方式", () => {
    const r = resolvePullExplanation(null, false, false, P);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].label).toBe("按 Git 配置执行");
    expect(r.rows[0].code).toBeNull();
    expect(r.willNot).toContain("不会承诺");
  });

  it("strategy 行携带选项 code,Intent 提及目标", () => {
    const r = resolvePullExplanation("--rebase", false, false, P);
    expect(r.rows[0].code).toBe("--rebase");
    expect(r.intent).toContain("接到远端最新提交后面");
    expect(r.intent).toContain("origin");
    expect(r.intent).toContain("main");
  });

  it("noCommit/noVerify 追加行,tone 随 strategy 变化(muted vs attention)", () => {
    const def = resolvePullExplanation(null, true, true, P);
    expect(def.rows.map((x) => x.code)).toEqual([null, "--no-commit", "--no-verify"]);
    expect(def.rows[1].tone).toBe("neutral");
    expect(def.rows[2].tone).toBe("attention");

    const rebase = resolvePullExplanation("--rebase", true, true, P);
    expect(rebase.rows[1].tone).toBe("muted");
    expect(rebase.rows[2].tone).toBe("muted");

    const squash = resolvePullExplanation("--squash", true, true, P);
    expect(squash.rows[1].tone).toBe("muted");
    expect(squash.rows[2].tone).toBe("muted");
  });

  it("四策略的 Will NOT 各不相同且不含推送承诺", () => {
    const texts = new Set<string>();
    for (const s of ["--rebase", "--ff-only", "--no-ff", "--squash"] as PullStrategy[]) {
      const r = resolvePullExplanation(s, false, false, P);
      texts.add(r.willNot);
      expect(r.willNot).toContain("不会");
    }
    expect(texts.size).toBe(4);
  });
});

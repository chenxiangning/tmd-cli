/**
 * pushDialogModel 契约 —— buildPushHeroTokens(hero token 流):
 * 形态 branch -> remote:target 共 5 段;末两段(operator ":" 与目标 branch)带
 * separatorBefore "" 紧贴成 origin:main 形态;
 * 空值兜底:branch 空→HEAD、remote 空(或纯空白)→origin、target 空(或纯空白)→回落 branch;
 * gerrit 时 target 加 refs/for/ 前缀,target 空同样先回落 branch 再加前缀;
 * remote/target 先 trim 后参与兜底判定。
 * useSyncTargetToLeafs 为 React hook(仓规:hooks 一律跳过不测)。
 */
import { describe, expect, it } from "vitest";
import { buildPushHeroTokens } from "./pushDialogModel";

describe("buildPushHeroTokens", () => {
  it("常规推送:branch -> remote:target 五段,末两段紧贴(separatorBefore 空串)", () => {
    expect(buildPushHeroTokens("main", "origin", "dev", false)).toEqual([
      { kind: "branch", value: "main" },
      { kind: "operator", value: "->" },
      { kind: "remote", value: "origin" },
      { kind: "operator", value: ":", separatorBefore: "" },
      { kind: "branch", value: "dev", separatorBefore: "" },
    ]);
  });

  it("空值兜底:branch 空→HEAD;target 空回落 branch;remote 空→origin", () => {
    expect(buildPushHeroTokens("", "origin", "", false)).toEqual([
      { kind: "branch", value: "HEAD" },
      { kind: "operator", value: "->" },
      { kind: "remote", value: "origin" },
      { kind: "operator", value: ":", separatorBefore: "" },
      { kind: "branch", value: "", separatorBefore: "" }, // branch 也空时无处回落
    ]);
    expect(buildPushHeroTokens("main", "", "dev", false)[2]).toEqual({
      kind: "remote",
      value: "origin",
    });
    expect(buildPushHeroTokens("main", "origin", "", false)[4]).toEqual({
      kind: "branch",
      value: "main",
      separatorBefore: "",
    });
  });

  it("gerrit:target 加 refs/for/ 前缀;target 空先回落 branch 再加前缀", () => {
    expect(buildPushHeroTokens("main", "gerrit", "feature/x", true)[4]).toEqual({
      kind: "branch",
      value: "refs/for/feature/x",
      separatorBefore: "",
    });
    expect(buildPushHeroTokens("main", "gerrit", "", true)[4]).toEqual({
      kind: "branch",
      value: "refs/for/main",
      separatorBefore: "",
    });
  });

  it("remote/target 先 trim:纯空白等同空值,合法值剥净首尾空白", () => {
    expect(buildPushHeroTokens("main", "  ", "  ", false)[2]).toEqual({
      kind: "remote",
      value: "origin",
    });
    expect(buildPushHeroTokens("main", " origin ", " dev ", false)).toEqual([
      { kind: "branch", value: "main" },
      { kind: "operator", value: "->" },
      { kind: "remote", value: "origin" },
      { kind: "operator", value: ":", separatorBefore: "" },
      { kind: "branch", value: "dev", separatorBefore: "" },
    ]);
  });
});

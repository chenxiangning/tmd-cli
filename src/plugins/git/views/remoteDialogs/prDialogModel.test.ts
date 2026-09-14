/**
 * prDialogModel 单测 —— 表单构造/请求装配/阶段合并/提交就绪(git 插件既有 vitest 口径)。
 */

import { describe, expect, it } from "vitest";
import type { GitPrDefaults, GitPrStage } from "@kernel/ipc";
import {
  buildRequest,
  canSubmit,
  formFromDefaults,
  initialStages,
  mergeStages,
  remoteBranchShort,
} from "./prDialogModel";

const DEFAULTS: GitPrDefaults = {
  upstreamRepo: "zhukunpenglinyutong/desktop-cc-gui",
  baseBranch: "v1.0.1",
  headOwner: "chenxiangning",
  headBranch: "feat/wsl",
  title: "feat(wsl): wsl 插件支持",
  body: "## 背景\n- x",
  commentBody: "@zhukunpenglinyutong 麻烦审批,已完成验证。",
  canCreate: true,
  disabledReason: null,
};

describe("formFromDefaults", () => {
  it("defaults 全量灌入且评论默认开", () => {
    const f = formFromDefaults(DEFAULTS);
    expect(f).toMatchObject({
      upstreamRepo: DEFAULTS.upstreamRepo,
      baseBranch: "v1.0.1",
      headOwner: "chenxiangning",
      headBranch: "feat/wsl",
      title: DEFAULTS.title,
      commentAfterCreate: true,
      commentBody: DEFAULTS.commentBody,
    });
  });
});

describe("buildRequest", () => {
  it("表单装配请求;gate 确认字段原样透传", () => {
    const f = formFromDefaults(DEFAULTS);
    const plain = buildRequest(f, false, null);
    expect(plain).toMatchObject({
      upstreamRepo: DEFAULTS.upstreamRepo,
      baseBranch: "v1.0.1",
      headOwner: "chenxiangning",
      headBranch: "feat/wsl",
      allowLargeRange: false,
      confirmedRangeFingerprint: null,
    });
    const authorized = buildRequest(f, true, "aaa...bbb");
    expect(authorized.allowLargeRange).toBe(true);
    expect(authorized.confirmedRangeFingerprint).toBe("aaa...bbb");
  });

  it("空描述/关闭评论折叠为 null(后端走模板兜底/跳过)", () => {
    const f = { ...formFromDefaults(DEFAULTS), body: "  ", commentAfterCreate: false };
    const req = buildRequest(f, false, null);
    expect(req.body).toBeNull();
    expect(req.commentBody).toBeNull();
  });
});

describe("stages", () => {
  it("初始四卡全 pending,顺序恒定", () => {
    expect(initialStages().map((s) => [s.key, s.status])).toEqual([
      ["precheck", "pending"],
      ["push", "pending"],
      ["createPr", "pending"],
      ["comment", "pending"],
    ]);
  });

  it("事件权威覆盖;本地多出的 key 保留在尾", () => {
    const local: GitPrStage[] = [
      { key: "precheck", status: "pending", detail: "" },
      { key: "push", status: "pending", detail: "" },
    ];
    const event: GitPrStage[] = [
      { key: "precheck", status: "success", detail: "预检通过" },
      { key: "push", status: "running", detail: "推送中" },
      { key: "createPr", status: "pending", detail: "" },
      { key: "comment", status: "pending", detail: "" },
    ];
    expect(mergeStages(local, event)).toEqual(event);
    expect(mergeStages(event, event.slice(0, 2)).map((s) => s.key)).toEqual([
      "precheck",
      "push",
      "createPr",
      "comment",
    ]);
  });
});

describe("canSubmit / remoteBranchShort", () => {
  it("五必填任一为空即不可提交", () => {
    const f = formFromDefaults(DEFAULTS);
    expect(canSubmit(f)).toBe(true);
    expect(canSubmit({ ...f, title: " " })).toBe(false);
    expect(canSubmit({ ...f, upstreamRepo: "" })).toBe(false);
    expect(canSubmit(null)).toBe(false);
  });

  it("远端分支名去前缀,无前缀原样", () => {
    expect(remoteBranchShort("origin/main")).toBe("main");
    expect(remoteBranchShort("main")).toBe("main");
  });
});

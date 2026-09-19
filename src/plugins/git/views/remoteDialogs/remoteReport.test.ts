/**
 * remoteReport 契约 —— formatRemoteReport(完成通知明细文案):
 * fetch:upToDate→已是最新,否则报更新引用数;
 * push:upToDate→远端已是最新,否则报推送提交数;
 * pull:upToDate→已是最新;有提交→合入 N 提交 + 文件变更(+i -d);
 *      无提交但有文件变更(--squash 暂存态)→只报文件变更。
 */
import { describe, expect, it } from "vitest";
import type { GitRemoteOpReport } from "@kernel/ipc";
import { formatRemoteReport } from "./remoteReport";

function report(partial: Partial<GitRemoteOpReport>): GitRemoteOpReport {
  return { upToDate: false, commits: 0, files: 0, insertions: 0, deletions: 0, refs: 0, ...partial };
}

describe("formatRemoteReport", () => {
  it("fetch:已是最新 / 更新 N 个远端引用", () => {
    expect(formatRemoteReport("fetch", "获取", report({ upToDate: true }))).toBe(
      "获取成功:远端引用已是最新。",
    );
    expect(formatRemoteReport("fetch", "获取", report({ refs: 3 }))).toBe(
      "获取成功:更新 3 个远端引用。",
    );
  });

  it("push:远端已是最新 / 已推送 N 个提交", () => {
    expect(formatRemoteReport("push", "推送", report({ upToDate: true }))).toBe(
      "推送成功:远端已是最新。",
    );
    expect(formatRemoteReport("push", "推送", report({ commits: 2 }))).toBe(
      "推送成功:已推送 2 个提交。",
    );
  });

  it("pull:已是最新 / 合入提交+文件变更明细 / 仅文件变更(squash 暂存态)", () => {
    expect(formatRemoteReport("pull", "拉取", report({ upToDate: true }))).toBe(
      "拉取成功:已是最新。",
    );
    expect(
      formatRemoteReport("pull", "拉取", report({ commits: 2, files: 3, insertions: 10, deletions: 4 })),
    ).toBe("拉取成功:合入 2 个提交,3 个文件变更(+10 -4)。");
    expect(
      formatRemoteReport("pull", "拉取", report({ commits: 0, files: 1, insertions: 5, deletions: 0 })),
    ).toBe("拉取成功:1 个文件变更(+5 -0)。");
  });
});

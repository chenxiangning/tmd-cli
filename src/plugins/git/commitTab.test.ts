/**
 * commitTab 契约:一提交一 tab(sha 锚定)、path 即短 sha(AppShell 标签取 baseName)、
 * 重复打开只刷 focusPath(深链);readCommitTabPayload 拒绝非本 kind/缺参 payload。
 */

import { describe, expect, it } from "vitest";
import { closeTab, getTabs } from "@kernel/tabs";
import { COMMIT_TAB_KIND, openCommitDiffTab, readCommitTabPayload } from "./commitTab";

const SHA = "a".repeat(40);

/** 窄化 payload 并取 focusPath(in 守卫,不做断言)。 */
function focusPathOf(tabId: string): string | undefined {
  const tab = getTabs().find((t) => t.id === tabId);
  if (!tab || typeof tab.payload !== "object" || tab.payload === null) return undefined;
  if (!("focusPath" in tab.payload)) return undefined;
  return tab.payload.focusPath as string | undefined;
}

describe("commitTab", () => {
  it("open → sha 锚定 tab;path 标签 = 短 sha;重复打开刷新 focusPath", () => {
    closeTab(`${COMMIT_TAB_KIND}:${SHA}`);
    openCommitDiffTab({
      cwd: "/repo", sha: SHA, shortSha: "aaaaaaa", summary: "s",
      authorName: "t", authorWhen: 1, focusPath: "x.ts",
    });
    const tab = getTabs().find((t) => t.id === `${COMMIT_TAB_KIND}:${SHA}`);
    expect(tab?.kind).toBe(COMMIT_TAB_KIND);
    expect(tab?.path).toBe("/repo/aaaaaaa");
    expect(focusPathOf(`${COMMIT_TAB_KIND}:${SHA}`)).toBe("x.ts");

    openCommitDiffTab({
      cwd: "/repo", sha: SHA, shortSha: "aaaaaaa", summary: "s",
      authorName: "t", authorWhen: 1, focusPath: "y.ts",
    });
    expect(focusPathOf(`${COMMIT_TAB_KIND}:${SHA}`)).toBe("y.ts");
    expect(getTabs().filter((t) => t.id === `${COMMIT_TAB_KIND}:${SHA}`)).toHaveLength(1);
  });

  it("readCommitTabPayload 拒绝非本 kind / 缺参 payload,补全缺省字段", () => {
    expect(readCommitTabPayload({ kind: "file", payload: {} })).toBeNull();
    expect(readCommitTabPayload({ kind: COMMIT_TAB_KIND, payload: {} })).toBeNull();
    const read = readCommitTabPayload({ kind: COMMIT_TAB_KIND, payload: { cwd: "/r", sha: SHA } });
    expect(read).toMatchObject({ cwd: "/r", sha: SHA, shortSha: SHA.slice(0, 7), summary: "" });
  });
});

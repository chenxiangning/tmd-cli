/**
 * pushHistory 契约:同目标去重、新条目置顶、上限 3;gerrit 标志参与身份判定
 * (同 remote/branch 的普通推送与 Gerrit 推送是两个历史条目)。
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  isSamePushTarget,
  loadPushHistory,
  rememberPushTarget,
  resetPushHistory,
} from "./pushHistory";

const CWD = "/tmp/push-history-test";

describe("pushHistory", () => {
  beforeEach(() => resetPushHistory(CWD));

  it("记住、去重并置顶最新目标,上限 3 条", () => {
    rememberPushTarget(CWD, { remote: "origin", branch: "a", gerrit: false });
    rememberPushTarget(CWD, { remote: "origin", branch: "b", gerrit: false });
    rememberPushTarget(CWD, { remote: "up", branch: "c", gerrit: false });
    // 重复 a → 移到队首而非追加
    rememberPushTarget(CWD, { remote: "origin", branch: "a", gerrit: false });
    const list = loadPushHistory(CWD);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ remote: "origin", branch: "a", gerrit: false });
    expect(list[1]).toEqual({ remote: "up", branch: "c", gerrit: false });
    expect(list[2]).toEqual({ remote: "origin", branch: "b", gerrit: false });
    // 第 4 条挤掉最旧
    rememberPushTarget(CWD, { remote: "origin", branch: "d", gerrit: false });
    expect(loadPushHistory(CWD).map((e) => e.branch)).toEqual(["d", "a", "c"]);
  });

  it("gerrit 标志区分同 remote/branch 的条目", () => {
    rememberPushTarget(CWD, { remote: "origin", branch: "x", gerrit: false });
    rememberPushTarget(CWD, { remote: "origin", branch: "x", gerrit: true });
    const list = loadPushHistory(CWD);
    expect(list[0]).toEqual({ remote: "origin", branch: "x", gerrit: true });
    expect(list[1]).toEqual({ remote: "origin", branch: "x", gerrit: false });
    expect(isSamePushTarget(list[0], list[1])).toBe(false);
  });
});

/**
 * 启动自动激活收集纯函数契约测试(pickAutoActivateCandidates)。
 * 覆盖:天数窗口过滤、全局 modifiedAt 降序、max 截断、
 * 缺 resumeArgs / singleInstance 组跳过、days=0 全关。
 */
import { describe, expect, it } from "vitest";
import type { CliDiskSession } from "./cli";
import { pickAutoActivateCandidates } from "./autoActivate";

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function disk(id: string, modifiedAt: number): CliDiskSession {
  return { id, path: `/d/${id}.jsonl`, modifiedAt };
}

const profileA = { id: "cli-a", resumeArgs: (id: string) => ["--resume", id] };
const profileB = { id: "cli-b", resumeArgs: (id: string) => ["--resume", id] };
const ws1 = { id: "ws1", root: "/p1" };
const ws2 = { id: "ws2", root: "/p2" };

describe("pickAutoActivateCandidates", () => {
  it("窗口过滤 + 全局降序 + max 截断", () => {
    const groups = [
      {
        profile: profileA,
        workspace: ws1,
        sessions: [disk("a-old", NOW - 5 * DAY), disk("a-1", NOW - 1_000)],
      },
      {
        profile: profileB,
        workspace: ws2,
        sessions: [disk("b-2", NOW - 2_000), disk("b-1", NOW - 500)],
      },
    ];
    const out = pickAutoActivateCandidates(groups, NOW, { days: 2, max: 2 });
    expect(out.map((c) => c.cliSessionId)).toEqual(["b-1", "a-1"]);
    expect(out[0]).toMatchObject({
      profileId: "cli-b",
      cwd: "/p2",
      workspaceId: "ws2",
    });
  });

  it("缺 resumeArgs 与 singleInstance 的组跳过", () => {
    const groups = [
      { profile: { id: "cli-noresume" }, workspace: ws1, sessions: [disk("x", NOW)] },
      {
        profile: { ...profileA, singleInstance: true },
        workspace: ws1,
        sessions: [disk("y", NOW)],
      },
      { profile: profileB, workspace: ws1, sessions: [disk("z", NOW)] },
    ];
    const out = pickAutoActivateCandidates(groups, NOW, { days: 2, max: 8 });
    expect(out.map((c) => c.cliSessionId)).toEqual(["z"]);
  });

  it("days=0 关闭;days 边界含整天", () => {
    const groups = [
      { profile: profileA, workspace: ws1, sessions: [disk("edge", NOW - 2 * DAY)] },
    ];
    expect(pickAutoActivateCandidates(groups, NOW, { days: 0, max: 8 })).toEqual([]);
    expect(
      pickAutoActivateCandidates(groups, NOW, { days: 2, max: 8 }).map((c) => c.cliSessionId),
    ).toEqual(["edge"]);
  });
});

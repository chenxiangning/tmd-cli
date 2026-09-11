/**
 * resolveBroadcastTargets 契约:kept 公式同构(条内 + 活跃兜底)、
 * 逐目标解析 profile、无会话/无 profile(ssh/shell)跳过、顺序 = tab 打开序。
 */
import { describe, expect, it } from "vitest";
import type { CliProfile } from "@kernel/cli";
import type { SessionMeta } from "@kernel/ipc";
import { resolveBroadcastTargets } from "./broadcastTargets";

const profile = (id: string): CliProfile => ({ id, name: id, command: id, args: [] }) as unknown as CliProfile;
const session = (id: string, profileId: string): SessionMeta =>
  ({ id, profileId, cwd: "/w" }) as SessionMeta;

const profiles: Record<string, CliProfile> = { claude: profile("claude"), omp: profile("omp") };
const getProfile = (pid: string) => profiles[pid];

describe("resolveBroadcastTargets", () => {
  it("tab 序解析 profile,顺序 = 打开序", () => {
    const sessions = [session("a", "claude"), session("b", "omp")];
    expect(resolveBroadcastTargets(["a", "b"], "b", sessions, getProfile).map((t) => t.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("活跃会话不在条内:兜底补挂(与 MainPanel kept 同构)", () => {
    const sessions = [session("a", "claude"), session("ghost", "omp")];
    const got = resolveBroadcastTargets(["a"], "ghost", sessions, getProfile);
    expect(got.map((t) => t.id)).toEqual(["a", "ghost"]);
  });

  it("无 profile 的会话(ssh/shell)与已消失会话跳过", () => {
    const sessions = [session("a", "claude"), session("s", "ssh"), session("b", "omp")];
    const got = resolveBroadcastTargets(["a", "s", "gone", "b"], "b", sessions, getProfile);
    expect(got.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

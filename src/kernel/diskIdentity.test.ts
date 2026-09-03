/**
 * 内容证据身份匹配的契约测试(纯函数,无 IO)。
 * 实证缺陷:mtime 水位仲裁在懒落盘 CLI(omp 首条消息才 flush)+ 同 cwd
 * 并行 spawn 下把两会话的绑定整个互换 —— 文件出生时刻(≈对方 spawn 后)
 * 被"归其 mtime 前最近 spawn"规则判给了错误的会话。
 * 契约:文件自证 createdAt ≈ spawn 时刻者胜,兄弟会话更近的文件让位(防偷文件);
 * cwd 不符/归属兄弟 = unmatched(强拒绝,不得退回水位线猜法);
 * 读不出身份或多无时间戳候选并列 = unreadable(才允许兜底仲裁)。
 */
import { describe, expect, it } from "vitest";
import {
  listFreshCandidates,
  pickContentIdentity,
  pickFreshIdentity,
} from "./diskIdentity";
import type { CliDiskSession, SessionFileIdentity } from "./cli";

const session = (id: string, modifiedAt: number): CliDiskSession => ({
  id,
  modifiedAt,
  path: `/data/${id}.jsonl`,
});

const identity =
  (id_: string, cwd?: string, createdAt?: number): ((path: string) => Promise<SessionFileIdentity | null>) =>
  async (path) =>
    path.includes("unreadable")
      ? null
      : { id: id_, cwd, createdAt };

describe("pickContentIdentity(内容证据匹配)", () => {
  it("实证互换场景:两个懒落盘文件都在对方 spawn 后出生,按 createdAt 归位", async () => {
    /* 复刻 2026-09-03 时间线:spawn A 15:41:16、spawn B 15:42:24;
       A 文件 15:42:50 才落盘(内容 createdAt = 15:41:16),B 文件 15:43:52。 */
    const spawnA = Date.parse("2026-09-03T07:41:16Z");
    const candidates = [
      session("file-a", Date.parse("2026-09-03T07:42:50Z")),
      session("file-b", Date.parse("2026-09-03T07:43:52Z")),
    ];
    const read: (path: string) => Promise<SessionFileIdentity | null> = async (p) => {
      const ms = p.includes("file-a")
        ? Date.parse("2026-09-03T07:41:16Z")
        : Date.parse("2026-09-03T07:42:24Z");
      return { id: p.match(/\/data\/(.+)\.jsonl/)![1], createdAt: ms };
    };
    expect(await pickContentIdentity(candidates, "/repo", spawnA, read)).toEqual({
      kind: "matched",
      id: "file-a",
    });
    expect(
      await pickContentIdentity(candidates, "/repo", Date.parse("2026-09-03T07:42:24Z"), read),
    ).toEqual({ kind: "matched", id: "file-b" });
  });

  it("cwd 不符一票否决,即使 createdAt 更近", async () => {
    const candidates = [session("other-cwd", 100)];
    const read = identity("other-cwd", "/elsewhere", 1000);
    expect(await pickContentIdentity(candidates, "/repo", 1005, read)).toEqual({
      kind: "unmatched",
    });
  });

  it("cwd 分隔符/尾斜杠归一后等值", async () => {
    const candidates = [session("win", 1)];
    const read = identity("win", "C:\\repo\\", 500);
    expect(await pickContentIdentity(candidates, "C:/repo", 501, read)).toEqual({
      kind: "matched",
      id: "win",
    });
  });

  it("无 createdAt:唯一合格候选直接采信;有 createdAt 的胜出/多候选并列退水位线", async () => {
    const read = async (path: string): Promise<SessionFileIdentity | null> => {
      const id = path.match(/\/data\/(.+)\.jsonl/)![1];
      return id === "with-ts" ? { id, createdAt: 9_999 } : { id };
    };
    expect(await pickContentIdentity([session("no-ts", 1)], "/repo", 10_000, read)).toEqual({
      kind: "matched",
      id: "no-ts",
    });
    expect(
      await pickContentIdentity([session("no-ts", 1), session("with-ts", 2)], "/repo", 10_000, read),
    ).toEqual({ kind: "matched", id: "with-ts" });
    expect(
      await pickContentIdentity([session("no-ts", 1), session("no-ts-2", 2)], "/repo", 10_000, read),
    ).toEqual({ kind: "unreadable" });
  });

  it("全部读不出身份 → unreadable(退回水位线仲裁)", async () => {
    const candidates = [session("unreadable", 1)];
    expect(await pickContentIdentity(candidates, "/repo", 2, identity("x"))).toEqual({
      kind: "unreadable",
    });
    expect(await pickContentIdentity([], "/repo", 2, identity("x"))).toEqual({
      kind: "unreadable",
    });
  });

  it("兄弟仲裁:兄弟的新文件(createdAt ≈ 兄弟 spawn)不偷,即使离我也近", async () => {
    /* 偷文件回归:本会话 spawn t=0 后在 CLI 内 /resume 老会话(自文件 createdAt
       远古),兄弟 spawn t=100 的新文件 createdAt=100 —— 纯距离评分会把它误判给
       本会话(|100−0| 比远古近)。 */
    const candidates = [session("sib-file", 150)];
    const read = identity("sib-file", "/repo", 100);
    expect(await pickContentIdentity(candidates, "/repo", 0, read, [100])).toEqual({
      kind: "unmatched",
    });
    /* 兄弟视角:自己的文件,正常 matched */
    expect(await pickContentIdentity(candidates, "/repo", 100, read, [0])).toEqual({
      kind: "matched",
      id: "sib-file",
    });
  });

  it("自证 id ≠ 列表 id(文件名)→ 剔除该候选,不猜", async () => {
    const candidates = [session("list-id", 1)];
    const read = async (): Promise<SessionFileIdentity> => ({
      id: "content-id",
      cwd: "/repo",
      createdAt: 1,
    });
    expect(await pickContentIdentity(candidates, "/repo", 2, read)).toEqual({
      kind: "unreadable",
    });
  });

  it("createdAt 距离平局让老会话(先 spawn 先认领)", async () => {
    /* 文件 createdAt 恰在两会话 spawn 正中:老会话胜,年轻会话让位 */
    const candidates = [session("mid", 50)];
    const read = identity("mid", "/repo", 50);
    expect(await pickContentIdentity(candidates, "/repo", 40, read, [60])).toEqual({
      kind: "matched",
      id: "mid",
    });
    expect(await pickContentIdentity(candidates, "/repo", 60, read, [40])).toEqual({
      kind: "unmatched",
    });
  });
});

describe("listFreshCandidates(水位线候选集)", () => {
  const before = new Map([["old", 100]]);
  it("有基线:新文件与复活文件都入候选;已认领与陈旧文件排除", () => {
    const list = [
      session("old", 100), // 基线内未增长
      session("old-revived", 200), // 基线内但增长(复活)
      session("new", 300), // 基线外
      session("claimed", 400), // 已认领
    ];
    const out = listFreshCandidates(list, before, 150, new Set(["claimed"]));
    expect(out.map((s) => s.id)).toEqual(["old-revived", "new"]);
  });
  it("无基线:只认 spawn 水位线之后的落盘", () => {
    const list = [session("pre", 99), session("post", 101), session("taken", 102)];
    const out = listFreshCandidates(list, null, 100, new Set(["taken"]));
    expect(out.map((s) => s.id)).toEqual(["post"]);
  });
});

describe("pickFreshIdentity(水位线仲裁,内容匹配的兜底路径)", () => {
  it("契约保持:listSessions mtime 倒序入参,findLast = 最旧,先 spawn 先认领", () => {
    const baseline = new Map([["old", 100]]);
    const list = [session("new-2", 301), session("new-1", 300)];
    expect(pickFreshIdentity(list, baseline, 150, new Set())).toBe("new-1");
    const revivedOnly = [session("old-revived", 200), session("old", 100)];
    expect(pickFreshIdentity(revivedOnly, baseline, 150, new Set())).toBe("old-revived");
  });
});

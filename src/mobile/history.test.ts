/**
 * history 数据面契约:① groupHomeRows 纯装配(全工作区列出/磁盘行按 root 归组/
 * 搜索过滤/活磁盘并存/未归属桶);② scanWorkspaceHistory 逐引擎注名 + 单引擎失败不阻塞。
 * 引擎扫描器全部 mock —— 本文件不验证各家磁盘格式(适配器自有测试),只验证装配语义。
 */

import { describe, expect, it, vi } from "vitest";
import type { CliDiskSession } from "@kernel/cli";

const disk = (id: string, modifiedAt: number, title?: string): CliDiskSession => ({
  id,
  modifiedAt,
  path: `/p/${id}.jsonl`,
  title,
});

const ompSession = disk("omp-1", 3000, "omp 标题");
const piSession = disk("pi-1", 2000);
const claudeSession = disk("claude-1", 1000, "claude 标题");

vi.mock("@plugins/cli-omp/edits", () => ({ ompSessionsDir: "OMP-DIR" }));
vi.mock("@plugins/cli-pi/edits", () => ({ piSessionsDir: "PI-DIR" }));
vi.mock("@plugins/cli-shared/piFamily", () => ({
  piFamilySessions: ({ sessionsDir }: { sessionsDir: string }) => ({
    listSessions: async () =>
      sessionsDir === "OMP-DIR" ? [ompSession] : sessionsDir === "PI-DIR" ? [piSession] : [],
  }),
}));
vi.mock("@plugins/cli-claude/sessions", () => ({
  listClaudeSessions: async () => [claudeSession],
}));
vi.mock("@plugins/cli-codex/sessions", () => ({
  listCodexSessions: async () => {
    throw new Error("boom");
  },
}));
vi.mock("@plugins/cli-kimi/kimiSessions", () => ({ listKimiSessions: async () => [] }));
vi.mock("@plugins/cli-grok/sessions", () => ({ listGrokSessions: async () => [] }));
vi.mock("@plugins/cli-shared/qoderSessionModel", () => ({
  listQoderSessions: async () => [],
}));

import { groupHomeRows, partitionByArchive, pinKeyOf, scanWorkspaceHistory, topZones, type HomeRow } from "./history";

const ws = (id: string, root: string, name = id) => ({ id, root, name });

describe("groupHomeRows", () => {
  const workspaces = [ws("w1", "/w1", "tmd-cli"), ws("w2", "/w2", "空工作区")];
  const history = new Map([
    ["/w1", [{ profileId: "claude", session: claudeSession }]],
  ]);
  const sessions = [
    { id: "pty-1", profileId: "omp", cwd: "/w1", workspaceId: "w1", createdAt: 5000 },
    { id: "pty-2", profileId: "shell", cwd: "/elsewhere", createdAt: 4000 },
  ];
  const args = {
    workspaces,
    sessions,
    history,
    q: "",
    overlayTitles: {} as Record<string, string>,
    titleOfLive: (s: { id: string }) => `live:${s.id}`,
    titleOfDisk: (h: { session: CliDiskSession }) => h.session.title ?? h.session.id,
  };

  it("活会话已落盘(cliSessionId 命中磁盘项):借磁盘真标题并对同会话磁盘行去重", () => {
    const bound = {
      id: "pty-9",
      profileId: "claude",
      cwd: "/w1",
      workspaceId: "w1",
      createdAt: 9000,
      cliSessionId: claudeSession.id,
    };
    const groups = groupHomeRows({
      ...args,
      sessions: [bound],
      overlayTitles: { [`claude:${claudeSession.id}`]: "手动名" },
    });
    const rows = groups[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "live", title: "手动名" });
    /* 无手动名时回落磁盘标题 */
    const rows2 = groupHomeRows({ ...args, sessions: [bound] })[0].rows;
    expect(rows2).toHaveLength(1);
    expect(rows2[0]).toMatchObject({ kind: "live", title: claudeSession.title });
  });

  it("配置工作区全列出,空工作区也在;磁盘行按 root 归组,活磁盘并存且时间倒序", () => {
    const groups = groupHomeRows(args);
    expect(groups.map((g) => g.name)).toEqual(["tmd-cli", "default", "空工作区"]);
    const w1 = groups[0];
    expect(w1.rows.map((r) => r.kind)).toEqual(["live", "disk"]);
    expect(w1.rows[0]).toMatchObject({ key: "live:pty-1", title: "live:pty-1" });
    expect(w1.rows[1]).toMatchObject({
      key: "disk:claude:claude-1",
      title: "claude 标题",
      ts: 1000,
    });
    expect(groups[2].rows).toEqual([]);
    /* 无 workspaceId 的活会话落未归属桶,行仍在。 */
    expect(groups[1].rows[0]).toMatchObject({ key: "live:pty-2", profileId: "shell" });
  });

  it("搜索过滤按标题命中;活与磁盘行都参与", () => {
    expect(groupHomeRows({ ...args, q: "claude" })[0].rows.map((r) => r.key)).toEqual([
      "disk:claude:claude-1",
    ]);
    expect(groupHomeRows({ ...args, q: "pty-1" })[0].rows.map((r) => r.key)).toEqual([
      "live:pty-1",
    ]);
    expect(groupHomeRows({ ...args, q: "不存在的" })[0].rows).toEqual([]);
  });

  it("q 为空白串不过滤", () => {
    expect(groupHomeRows({ ...args, q: "  " })[0].rows).toHaveLength(2);
  });
});

describe("scanWorkspaceHistory", () => {
  it("逐引擎扫描并注名 profileId;单引擎失败被吞掉不阻塞其余", async () => {
    const items = await scanWorkspaceHistory("/w1");
    expect(items).toEqual([
      { profileId: "omp", session: ompSession },
      { profileId: "pi", session: piSession },
      { profileId: "claude", session: claudeSession },
    ]);
  });
});

describe("partitionByArchive", () => {
  const diskRow = (key: string, id: string): HomeRow => ({
    key,
    kind: "disk",
    profileId: "omp",
    title: key,
    ts: 10,
    disk: { id, modifiedAt: 10, path: `/p/${id}.jsonl` },
  });
  const liveRow: HomeRow = { key: "live:pty-1", kind: "live", profileId: "omp", title: "l", ts: 20 };
  it("磁盘行按 wsId:profileId:cliId 键切分;活行恒本地", () => {
    const rows = [liveRow, diskRow("disk:omp:a", "a"), diskRow("disk:omp:b", "b")];
    const p = partitionByArchive(rows, "w1", new Set(["w1:omp:b"]));
    expect(p.local.map((r) => r.key)).toEqual(["live:pty-1", "disk:omp:a"]);
    expect(p.archived.map((r) => r.key)).toEqual(["disk:omp:b"]);
  });
  it("归档集为空 = 全本地;键含工作区维度不跨组误伤", () => {
    const rows = [diskRow("disk:omp:a", "a")];
    expect(partitionByArchive(rows, "w1", new Set()).archived).toEqual([]);
    expect(partitionByArchive(rows, "w1", new Set(["w2:omp:a"])).local).toHaveLength(1);
  });
});

describe("topZones", () => {
  const live = (id: string, ts: number, cliSessionId?: string): HomeRow => ({
    key: `live:${id}`,
    kind: "live",
    profileId: "omp",
    title: id,
    ts,
    live: { id, profileId: "omp", cwd: "/w1", cliSessionId },
  });
  const disk = (id: string, ts: number): HomeRow => ({
    key: `disk:omp:${id}`,
    kind: "disk",
    profileId: "omp",
    title: id,
    ts,
    disk: { id, modifiedAt: ts, path: `/p/${id}.jsonl` },
  });
  const groups = [
    { wsId: "w1", name: "w1", rows: [live("a", 30, "ca"), disk("d1", 20)] },
    { wsId: "w2", name: "w2", rows: [live("b", 40)] },
  ];
  it("运行中 = 跨组活会话新在上;未绑定活行无置顶键", () => {
    const z = topZones({ groups, pins: {} });
    expect(z.running.map((r) => r.key)).toEqual(["live:b", "live:a"]);
    expect(pinKeyOf("w2", live("b", 40))).toBeNull();
    expect(pinKeyOf("w1", live("a", 30, "ca"))).toBe("w1:omp:ca");
    expect(pinKeyOf("w1", disk("d1", 20))).toBe("w1:omp:d1");
  });
  it("已置顶按 pinnedAt 升序;置顶活行从运行中排除(一行一区,桌面同律)", () => {
    const z = topZones({
      groups,
      pins: { "w1:omp:ca": { pinnedAt: 200 }, "w1:omp:d1": { pinnedAt: 100 } },
    });
    expect(z.pinned.map((r) => r.key)).toEqual(["disk:omp:d1", "live:a"]);
    expect(z.running.map((r) => r.key)).toEqual(["live:b"]);
  });
});

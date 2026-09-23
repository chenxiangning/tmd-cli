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

import { groupHomeRows, scanWorkspaceHistory, splitEngineGroups, type HomeRow } from "./history";

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
    titleOfLive: (s: { id: string }) => `live:${s.id}`,
    titleOfDisk: (h: { session: CliDiskSession }) => h.session.title ?? h.session.id,
  };

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

describe("splitEngineGroups", () => {
  const row = (key: string, profileId: string, ts: number): HomeRow => ({
    key,
    kind: "disk",
    profileId,
    title: key,
    ts,
  });
  it("按引擎切组:组按最近活动倒序,组内时间倒序", () => {
    const groups = splitEngineGroups([
      row("a", "omp", 50),
      row("b", "claude", 60),
      row("c", "omp", 70),
      row("d", "claude", 40),
    ]);
    expect(groups.map((g) => g.profileId)).toEqual(["omp", "claude"]);
    expect(groups[0].rows.map((r) => r.key)).toEqual(["c", "a"]);
    expect(groups[1].rows.map((r) => r.key)).toEqual(["b", "d"]);
  });
});

/**
 * 历史续聊契约(resume.ts):
 * - spawn 参数 = 引擎 resumeArgs 镜像(--resume / resume / --session 三种形态);
 * - 去重三级:内存表命中聚焦 → 磁盘日志指针 logId 在活表聚焦 → 冷 spawn;
 * - 引擎不在表 / cwd 缺 = null(调用方提示),绝不误 spawn。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { cmd: string; args: Record<string, unknown> }[] = [];
let pointerContent: string | null = null;

vi.mock("@kernel/transport", () => ({
  invoke: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args: args ?? {} });
    if (cmd === "config_home_dir") return Promise.resolve("/home/u");
    if (cmd === "fs_read_file")
      return pointerContent === null
        ? Promise.reject(new Error("missing"))
        : Promise.resolve(pointerContent);
    if (cmd === "session_spawn") return Promise.resolve({ id: "pty-new" });
    return Promise.resolve(null);
  }),
  listen: vi.fn(async () => () => undefined),
}));

import { resumeDiskSession } from "./resume";

const sessions = (ids: string[]) => ids.map((id) => ({ id, profileId: "omp", cwd: "/w" })) as never;

beforeEach(() => {
  calls.length = 0;
  pointerContent = null;
  vi.resetModules();
});

describe("resumeDiskSession", () => {
  it("冷开:session_spawn 带 --resume <id> 与工作区 cwd", async () => {
    const id = await resumeDiskSession({
      profileId: "omp",
      cwd: "/w",
      cliSessionId: "cli-9",
      workspaceId: "w1",
      sessions: sessions([]),
    });
    expect(id).toBe("pty-new");
    const spawn = calls.find((c) => c.cmd === "session_spawn");
    expect((spawn!.args.spec as { args: string[]; command: string }).args).toEqual(["--resume", "cli-9"]);
    expect((spawn!.args.spec as { cwd: string }).cwd).toBe("/w");
  });

  it("codex/kimi 参数形态各随其 CLI", async () => {
    await resumeDiskSession({ profileId: "codex", cwd: "/w", cliSessionId: "c1", sessions: sessions([]) });
    await resumeDiskSession({ profileId: "kimi", cwd: "/w", cliSessionId: "k1", sessions: sessions([]) });
    const specs = calls.filter((c) => c.cmd === "session_spawn").map((c) => (c.args.spec as { args: string[] }).args);
    expect(specs).toEqual([["resume", "c1"], ["--session", "k1"]]);
  });

  it("指针 logId 仍在活表 → 聚焦不重开", async () => {
    pointerContent = "pty-live";
    const id = await resumeDiskSession({
      profileId: "omp",
      cwd: "/w",
      cliSessionId: "cli-9",
      sessions: sessions(["pty-live"]),
    });
    expect(id).toBe("pty-live");
    expect(calls.some((c) => c.cmd === "session_spawn")).toBe(false);
  });

  it("指针存在但活表无该 id(会话已死)→ 冷开", async () => {
    pointerContent = "pty-dead";
    const id = await resumeDiskSession({
      profileId: "omp",
      cwd: "/w",
      cliSessionId: "cli-9",
      sessions: sessions(["other"]),
    });
    expect(id).toBe("pty-new");
  });

  it("引擎不在表 / cwd 缺 → null 不 spawn", async () => {
    expect(await resumeDiskSession({ profileId: "deepseek", cwd: "/w", cliSessionId: "x", sessions: sessions([]) })).toBeNull();
    expect(await resumeDiskSession({ profileId: "omp", cwd: "", cliSessionId: "x", sessions: sessions([]) })).toBeNull();
    expect(calls.some((c) => c.cmd === "session_spawn")).toBe(false);
  });
});

/**
 * memoryFilesData 单测 —— 声明展开(project=cwd / user=home 拼接)、三态归并、
 * 未声明分组、探测失败降级(纯函数面;probeMemoryFiles 经 ipc 桩验证降级)。
 */
import { describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ fsReadHeads: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

import {
  expandMemorySlots,
  probeMemoryFiles,
  slotState,
  summarizeMemoryFiles,
  undeclaredEngines,
  type MemoryProfileSource,
} from "./memoryFilesData";

/** 两引擎桩:claude 双槽(项目+用户)、kimi 单槽(项目)、omp 零声明。 */
const PROFILES: MemoryProfileSource = [
  {
    id: "claude",
    memoryFiles: [
      { scope: "project", label: "CLAUDE.md", relPath: "CLAUDE.md" },
      { scope: "user", label: "CLAUDE.md", relPath: ".claude/CLAUDE.md" },
    ],
  },
  { id: "kimi", memoryFiles: [{ scope: "project", label: "AGENTS.md", relPath: "AGENTS.md" }] },
  { id: "omp" },
];

describe("expandMemorySlots", () => {
  it("槽展开:project 拼 cwd、user 拼 home,无 cwd 时项目级槽不展开", () => {
    const { project, user } = expandMemorySlots(PROFILES, "/ws/demo", "/home/u");
    expect(project.map((s) => [s.engine, s.absPath])).toEqual([
      ["claude", "/ws/demo/CLAUDE.md"],
      ["kimi", "/ws/demo/AGENTS.md"],
    ]);
    expect(user).toEqual([
      { engine: "claude", scope: "user", label: "CLAUDE.md", relPath: ".claude/CLAUDE.md", absPath: "/home/u/.claude/CLAUDE.md" },
    ]);
    const noCwd = expandMemorySlots(PROFILES, null, "/home/u");
    expect(noCwd.project).toEqual([]);
    expect(noCwd.user).toHaveLength(1);
  });

  it("未声明分组:零声明引擎按注册序列出", () => {
    expect(undeclaredEngines(PROFILES)).toEqual(["omp"]);
    expect(undeclaredEngines([{ id: "dsh" }, { id: "grok" }])).toEqual(["dsh", "grok"]);
  });
});

describe("三态归并", () => {
  const { project, user } = expandMemorySlots(PROFILES, "/ws", "/home/u");
  const probe = { "/ws/CLAUDE.md": true, "/ws/AGENTS.md": false };

  it("在 / 未生成按探测结果归并", () => {
    expect(slotState(project[0], probe)).toBe("ok");
    expect(slotState(project[1], probe)).toBe("missing");
  });

  it("摘要计数:N 在 · M 缺 · K 未声明", () => {
    expect(summarizeMemoryFiles(project, user, probe, 1)).toEqual({ ok: 1, missing: 2, undeclared: 1 });
  });
});

describe("probeMemoryFiles", () => {
  it("批量读头:头部非空 = 在,空串 = 未生成", async () => {
    ipcMock.fsReadHeads.mockResolvedValue(["#", ""]);
    expect(await probeMemoryFiles(["/a", "/b"])).toEqual({ "/a": true, "/b": false });
    expect(ipcMock.fsReadHeads).toHaveBeenCalledWith(["/a", "/b"], 1);
  });

  it("IPC 整体失败 = 全部按未生成降级,不抛", async () => {
    ipcMock.fsReadHeads.mockRejectedValue(new Error("bridge down"));
    expect(await probeMemoryFiles(["/a", "/b"])).toEqual({ "/a": false, "/b": false });
  });

  it("空槽集不发起 IPC", async () => {
    expect(await probeMemoryFiles([])).toEqual({});
    expect(ipcMock.fsReadHeads).not.toHaveBeenCalled();
  });
});

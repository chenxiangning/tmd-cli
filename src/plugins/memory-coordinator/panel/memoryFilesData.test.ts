/**
 * memoryFilesData 单测 —— 声明展开(project=cwd / user=home 拼接)、三态归并、
 * 未声明分组、探测失败降级(纯函数面;probeMemoryFiles 经 ipc 桩验证降级)。
 */
import { describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ fsReadHeads: vi.fn(), fsCreateDir: vi.fn(), fsWriteFile: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

import {
  dedupeMemorySlots,
  entryState,
  expandMemorySlots,
  generateMemoryTemplate,
  memoryTemplate,
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

describe("按真实文件去重", () => {
  it("同路径多引擎合并为一行,引擎列保声明序;跨路径不合并", () => {
    const profiles: MemoryProfileSource = [
      { id: "codex", memoryFiles: [{ scope: "project", label: "AGENTS.md", relPath: "AGENTS.md" }] },
      { id: "kimi", memoryFiles: [{ scope: "project", label: "AGENTS.md", relPath: "AGENTS.md" }] },
      { id: "claude", memoryFiles: [{ scope: "project", label: "CLAUDE.md", relPath: "CLAUDE.md" }] },
    ];
    const { project } = expandMemorySlots(profiles, "/ws", "/home/u");
    const entries = dedupeMemorySlots(project);
    expect(entries.map((e) => [e.label, e.absPath, e.engines])).toEqual([
      ["AGENTS.md", "/ws/AGENTS.md", ["codex", "kimi"]],
      ["CLAUDE.md", "/ws/CLAUDE.md", ["claude"]],
    ]);
    expect(entries[0] && entryState(entries[0], { "/ws/AGENTS.md": true })).toBe("ok");
  });
});

describe("空模板生成", () => {
  it("模板 = 一行标题空壳;生成 = 先逐级确保父目录再覆写写盘", async () => {
    ipcMock.fsCreateDir.mockResolvedValue(undefined);
    ipcMock.fsWriteFile.mockResolvedValue(undefined);
    const slot = { engine: "kimi", scope: "project", label: "AGENTS.md", relPath: "AGENTS.md", absPath: "/ws/demo/AGENTS.md" } as const;
    expect(memoryTemplate(slot)).toBe("# AGENTS.md\n");
    await generateMemoryTemplate(slot);
    expect(ipcMock.fsWriteFile).toHaveBeenCalledWith("/ws/demo/AGENTS.md", "# AGENTS.md\n");
    /* 用户级深路径:父目录逐级确保在写盘之前 */
    const deep = { engine: "claude", scope: "user", label: "CLAUDE.md", relPath: ".claude/CLAUDE.md", absPath: "/home/u/.claude/CLAUDE.md" } as const;
    await generateMemoryTemplate(deep);
    expect(ipcMock.fsCreateDir.mock.calls.map((c) => c[0])).toContain("/home/u/.claude");
    expect(ipcMock.fsWriteFile).toHaveBeenLastCalledWith("/home/u/.claude/CLAUDE.md", "# CLAUDE.md\n");
  });

  it("写盘失败原样抛出(行内失败标记由面板侧归并)", async () => {
    ipcMock.fsCreateDir.mockResolvedValue(undefined);
    ipcMock.fsWriteFile.mockRejectedValueOnce(new Error("EACCES"));
    const slot = { engine: "kimi", scope: "project", label: "AGENTS.md", relPath: "AGENTS.md", absPath: "/ws/ro/AGENTS.md" } as const;
    await expect(generateMemoryTemplate(slot)).rejects.toThrow("EACCES");
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

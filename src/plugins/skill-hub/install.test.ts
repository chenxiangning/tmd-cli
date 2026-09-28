/**
 * 安装编排契约测试(fs/netDownload/skillExtract 桩):冲突矩阵(覆盖=回收站/
 * 缺省跳过)、落位选项(引擎多选/公约位/claude 补链与降级)、缓存清理、
 * 下载失败阶段态。owner 消歧桩为直通(消歧契约见 clawhub.test.ts)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ipc: {
    configHomeDir: vi.fn(),
    configDir: vi.fn(),
    fsListDir: vi.fn(),
    fsTrashEntry: vi.fn(),
    netDownload: vi.fn(),
    skillExtract: vi.fn(),
    skillSymlink: vi.fn(),
    fsRemovePath: vi.fn(),
  },
}));

vi.mock("@kernel/ipc", () => ({ ipc: mocks.ipc }));
/* 消歧直通:owner 已带;downloadUrl 由测试卡自持。 */
vi.mock("./clawhub", () => ({
  resolveClawHubOwner: vi.fn(async (card: { downloadUrl: string }) => card),
}));

import { installTargets, probeInstallConflicts, runInstall, type InstallTargetSpec } from "./install";
import type { ClawHubCard } from "./clawhubNormalize";

const CARD: ClawHubCard = {
  slug: "pdf",
  displayName: "Pdf",
  summary: "",
  topics: [],
  latestVersion: "1.0.0",
  downloads: 0,
  stars: 0,
  installsCurrent: 0,
  updatedAt: 0,
  ownerHandle: "awspace",
  webUrl: "",
  downloadUrl: "https://clawhub.ai/api/v1/download?slug=pdf&tag=latest&ownerHandle=awspace",
};

const HOME = "/home/u";
const ZIP = "/home/u/.tmd-cli/cache/skills/abc.tmp";

function dir(names: string[]) {
  return names.map((n) => ({ name: n, path: `${HOME}/x/${n}`, isDir: !n.endsWith(".md") }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ipc.configHomeDir.mockResolvedValue(HOME);
  mocks.ipc.configDir.mockResolvedValue(`${HOME}/.tmd-cli`);
  mocks.ipc.netDownload.mockResolvedValue({ path: ZIP, bytes: 10 });
  mocks.ipc.skillExtract.mockResolvedValue({ entries: 3 });
  mocks.ipc.fsListDir.mockRejectedValue(new Error("不是目录"));
  mocks.ipc.fsTrashEntry.mockResolvedValue(undefined);
  mocks.ipc.skillSymlink.mockResolvedValue(undefined);
  mocks.ipc.fsRemovePath.mockResolvedValue(undefined);
});

describe("installTargets / probeInstallConflicts(落位与冲突探测)", () => {
  it("引擎多选 + 公约位落位目录;未选引擎不落", async () => {
    const spec: InstallTargetSpec = { engines: ["claude", "kimi"], shared: true, claudeSymlink: false };
    const targets = await installTargets(HOME, spec);
    expect(targets.map((t) => t.dir)).toEqual([
      `${HOME}/.claude/skills`,
      `${HOME}/.kimi-code/skills`,
      `${HOME}/.agents/skills`,
    ]);
  });

  it("同名冲突探测(目录与平铺 .md 形);目录缺失 = 无冲突", async () => {
    mocks.ipc.fsListDir.mockImplementation(async (d: string) => {
      if (d === `${HOME}/.claude/skills`) return dir(["pdf"]);
      if (d === `${HOME}/.agents/skills`) return dir(["pdf.md"]);
      throw new Error("不是目录");
    });
    const spec: InstallTargetSpec = { engines: ["claude"], shared: true, claudeSymlink: false };
    const conflicts = await probeInstallConflicts(HOME, "pdf", spec);
    expect(conflicts.map((c) => c.target.label)).toEqual(["claude", "shared"]);
    expect(conflicts.map((c) => c.name)).toEqual(["pdf", "pdf.md"]);
  });
});

describe("runInstall(冲突矩阵与阶段态)", () => {
  const stages: string[] = [];

  it("无冲突:下载 → 逐目标解压 → 缓存 zip 删除", async () => {
    const spec: InstallTargetSpec = { engines: ["claude"], shared: false, claudeSymlink: false };
    const outcome = await runInstall(CARD, spec, new Map(), (s) => stages.push(s));
    expect(stages).toEqual(["download", "extract", "done"]);
    expect(outcome.stage).toBe("done");
    expect(outcome.targets).toEqual([
      { target: { dir: `${HOME}/.claude/skills`, label: "claude" }, state: "done" },
    ]);
    expect(mocks.ipc.skillExtract).toHaveBeenCalledWith(ZIP, `${HOME}/.claude/skills/pdf`, true);
    expect(mocks.ipc.netDownload).toHaveBeenCalledWith(CARD.downloadUrl, `${HOME}/.tmd-cli/cache/skills`);
    expect(mocks.ipc.fsRemovePath).toHaveBeenCalledWith(ZIP);
  });

  it("同名冲突未勾覆盖 = 跳过该目标,不动旧文件", async () => {
    mocks.ipc.fsListDir.mockResolvedValue(dir(["pdf"]));
    const spec: InstallTargetSpec = { engines: ["claude"], shared: false, claudeSymlink: false };
    const outcome = await runInstall(CARD, spec, new Map(), () => {});
    expect(outcome.targets[0].state).toBe("skipped");
    expect(mocks.ipc.fsTrashEntry).not.toHaveBeenCalled();
    expect(mocks.ipc.skillExtract).not.toHaveBeenCalled();
  });

  it("勾选覆盖 = 旧目录移回收站后解压", async () => {
    mocks.ipc.fsListDir.mockResolvedValue(dir(["pdf"]));
    const spec: InstallTargetSpec = { engines: ["claude"], shared: false, claudeSymlink: false };
    const outcome = await runInstall(
      CARD,
      spec,
      new Map([[`${HOME}/.claude/skills`, "overwrite"]]),
      () => {},
    );
    expect(outcome.targets[0].state).toBe("done");
    expect(mocks.ipc.fsTrashEntry).toHaveBeenCalledWith(`${HOME}/.claude/skills/pdf`);
    expect(mocks.ipc.skillExtract).toHaveBeenCalledTimes(1);
  });

  it("公约位 + claude 补链:symlink 目标/链接路径正确;失败降级不阻断", async () => {
    mocks.ipc.skillSymlink.mockRejectedValue(new Error("no priv"));
    const spec: InstallTargetSpec = { engines: [], shared: true, claudeSymlink: true };
    const outcome = await runInstall(CARD, spec, new Map(), () => {});
    expect(mocks.ipc.skillSymlink).toHaveBeenCalledWith(
      `${HOME}/.agents/skills/pdf`,
      `${HOME}/.claude/skills/pdf`,
    );
    expect(outcome.stage).toBe("done");
    expect(outcome.symlinkNote).toContain("no priv");
    expect(outcome.targets.map((t) => t.target.label)).toEqual(["shared"]);
  });

  it("单目标失败不拖垮其余:失败如实列出,已落位目标保留", async () => {
    mocks.ipc.skillExtract.mockImplementation(async (_a: string, dest: string) => {
      if (dest.startsWith(`${HOME}/.kimi-code`)) throw new Error("disk full");
      return { entries: 1 };
    });
    const spec: InstallTargetSpec = { engines: ["claude", "kimi"], shared: false, claudeSymlink: false };
    const outcome = await runInstall(CARD, spec, new Map(), () => {});
    expect(outcome.stage).toBe("done");
    expect(outcome.targets.map((t) => t.state)).toEqual(["done", "failed"]);
    expect(outcome.targets[1].error).toContain("disk full");
  });

  it("下载失败 = error 阶段,零目标", async () => {
    mocks.ipc.netDownload.mockRejectedValue(new Error("HTTP 502"));
    const spec: InstallTargetSpec = { engines: ["claude"], shared: false, claudeSymlink: false };
    const outcome = await runInstall(CARD, spec, new Map(), () => {});
    expect(outcome.stage).toBe("error");
    expect(outcome.error).toContain("502");
    expect(outcome.targets).toEqual([]);
    expect(mocks.ipc.skillExtract).not.toHaveBeenCalled();
  });
});

/**
 * 安装记录契约测试(fs 桩):读写 round-trip、可用性判定(自家目录/公约位
 * readsShared/claude symlink)、installedSkillSuggestions 过滤。
 * spec:docs/superpowers/specs/2026-09-28-composer-universal-skills-design.md(v2)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configDir: vi.fn(),
  fsReadFile: vi.fn(),
  fsWriteFile: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    configDir: mocks.configDir,
    fsReadFile: mocks.fsReadFile,
    fsWriteFile: mocks.fsWriteFile,
  },
}));

import {
  installedSkillSuggestions,
  loadSkillRegistry,
  recordUsableByProfile,
  removeSkillRecord,
  skillRegistrySnapshot,
  upsertSkillRecord,
} from "./skillRegistry";

const REC = {
  name: "pdf-tool",
  description: "PDF 处理",
  source: "import" as const,
  targets: [".agents/skills"],
  createdAt: 1,
};

beforeEach(() => {
  mocks.configDir.mockReset().mockResolvedValue("/home/t/.tmd-cli");
  mocks.fsReadFile.mockReset().mockResolvedValue("");
  mocks.fsWriteFile.mockReset().mockResolvedValue(undefined);
});

describe("skillRegistry 读写", () => {
  it("文件缺失 = 空表起步;upsert 后持久化 JSON,重载 round-trip", async () => {
    mocks.fsReadFile.mockResolvedValue("");
    await loadSkillRegistry(true);
    expect(skillRegistrySnapshot()).toEqual({ records: [], loaded: true });

    await upsertSkillRecord(REC);
    const written = mocks.fsWriteFile.mock.calls[0]?.[1] as string;
    expect(written).toContain('"pdf-tool"');

    mocks.fsReadFile.mockResolvedValue(written);
    await loadSkillRegistry(true);
    expect(skillRegistrySnapshot().records).toHaveLength(1);
    expect(skillRegistrySnapshot().records[0]?.name).toBe("pdf-tool");
  });

  it("同名 upsert = 覆盖(落位与来源更新);remove 清记录", async () => {
    await upsertSkillRecord(REC);
    await upsertSkillRecord({ ...REC, source: "store", targets: [".claude/skills"] });
    expect(skillRegistrySnapshot().records).toHaveLength(1);
    expect(skillRegistrySnapshot().records[0]?.source).toBe("store");

    await removeSkillRecord("pdf-tool");
    expect(skillRegistrySnapshot().records).toHaveLength(0);
  });

  it("configDir 抛错(测试桩环境)= 空表起步不拖垮", async () => {
    mocks.configDir.mockRejectedValue(new Error("no ipc"));
    await loadSkillRegistry(true);
    expect(skillRegistrySnapshot()).toEqual({ records: [], loaded: true });
  });
});

describe("记录 × profile 可用性(composer 级联判定)", () => {
  it("自家目录命中 / 公约位 readsShared / claude 需 symlink 落位", () => {
    expect(recordUsableByProfile({ ...REC, targets: [".omp/agent/skills"] }, "omp")).toBe(true);
    expect(recordUsableByProfile({ ...REC, targets: [".codex/skills"] }, "omp")).toBe(false);
    expect(recordUsableByProfile(REC, "omp")).toBe(true); // 公约位 omp 原生读
    expect(recordUsableByProfile(REC, "claude")).toBe(false); // claude 不读公约位
    expect(
      recordUsableByProfile({ ...REC, targets: [".agents/skills", ".claude/skills"] }, "claude"),
    ).toBe(true); // symlink 落位后可用
  });

  it("installedSkillSuggestions 只出当前 profile 可用的记录", () => {
    const records = [
      REC, // 公约位:omp 可用,claude 不可用
      { ...REC, name: "claude-only", targets: [".claude/skills"] },
      { ...REC, name: "codex-only", targets: [".codex/skills"] },
    ];
    const omp = installedSkillSuggestions("omp", records).map((s) => s.value);
    expect(omp).toContain("pdf-tool");
    expect(omp).not.toContain("claude-only");
    expect(omp).not.toContain("codex-only");
    const claude = installedSkillSuggestions("claude", records).map((s) => s.value);
    expect(claude).toContain("claude-only");
    expect(claude).not.toContain("pdf-tool");
  });
});

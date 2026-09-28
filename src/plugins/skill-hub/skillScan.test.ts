/**
 * 技能发现契约测试(fs 桩):buildHubSkills 纯函数(形态/优先级/徽标/
 * symlink 目录)与 scanAllSkillSources 编排(多引擎/缺目录/公约位/分组合并)。
 * 目录形态实证:2026-09-28 本机十引擎实况(提案 §4.3 目录表)。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fsListDir: vi.fn(),
  fsWalkFiles: vi.fn(),
  fsReadHead: vi.fn(),
}));

vi.mock("@kernel/ipc", () => ({
  ipc: {
    fsListDir: mocks.fsListDir,
    fsWalkFiles: mocks.fsWalkFiles,
    fsReadHead: mocks.fsReadHead,
  },
}));

import {
  buildHubSkills,
  hydrateSkillMeta,
  scanAllSkillSources,
  type HubSkill,
  type SkillDirSource,
} from "./skillScan";

const CLAUDE: SkillDirSource = { engine: "claude", badge: "user", rel: ".claude/skills" };
const SHARED: SkillDirSource = { engine: "shared", badge: "shared", rel: ".agents/skills" };
function entry(name: string, isDir: boolean) {
  return { name, path: `/x/${name}`, isDir };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fsWalkFiles.mockResolvedValue([]);
  mocks.fsReadHead.mockResolvedValue("");
});

describe("buildHubSkills(纯函数)", () => {
  it("目录式一层子目录成卡;元数据优先级 skill.json > SKILL.md > README.md", () => {
    const walk = [
      "a/SKILL.md",
      "b/README.md",
      "c/skill.md",
      "d/skill.json",
      "a/scripts/run.py", // 深层附属文件不是元数据
      "e/sub/SKILL.md", // 两层深不是技能形态
    ];
    const listing = [entry("a", true), entry("b", true), entry("c", true), entry("d", true), entry("e", true)];
    const skills = buildHubSkills(CLAUDE, "/h/.claude/skills", walk, listing);
    const byName = new Map(skills.map((s) => [s.name, s]));
    expect(byName.get("a")?.metaFile).toBe("/h/.claude/skills/a/SKILL.md");
    expect(byName.get("b")?.metaFile).toBe("/h/.claude/skills/b/README.md");
    expect(byName.get("c")?.metaFile).toBe("/h/.claude/skills/c/skill.md");
    expect(byName.get("d")?.metaFile).toBe("/h/.claude/skills/d/skill.json");
    expect(byName.has("e")).toBe(true); // 裸目录也有卡
    expect(byName.get("e")?.metaFile).toBeNull();
  });

  it("平铺 <name>.md(kimi 双形态)与根 SKILL.md 不算技能", () => {
    const listing = [entry("brainstorm.md", false), entry("SKILL.md", false), entry("note.txt", false)];
    const skills = buildHubSkills(CLAUDE, "/h/.kimi-code/skills", ["brainstorm.md"], listing);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: "brainstorm",
      flat: true,
      metaFile: "/h/.kimi-code/skills/brainstorm.md",
    });
  });

  it("dot 条目跳过;徽标按来源带出", () => {
    const listing = [entry(".staging", true), entry("good", true)];
    const skills = buildHubSkills(SHARED, "/h/.agents/skills", ["good/SKILL.md"], listing);
    expect(skills).toHaveLength(1);
    expect(skills[0].badge).toBe("shared");
    expect(skills[0].engine).toBe("shared");
  });

  it("symlink 技能目录(walk 不可见)metaFile 先置空,resolve 阶段补齐", () => {
    const listing = [entry("linked", true)];
    const skills = buildHubSkills(CLAUDE, "/h/.claude/skills", [], listing);
    expect(skills[0].metaFile).toBeNull();
    expect(skills[0].dir).toBe("/h/.claude/skills/linked");
  });
});

describe("hydrateSkillMeta", () => {
  const base: HubSkill = {
    name: "dir-name",
    description: "",
    dir: "/h/x/dir-name",
    metaFile: "/h/x/dir-name/SKILL.md",
    flat: false,
    badge: "user",
    engine: "claude",
  };

  it("frontmatter name/description 回填,超长截断(name 64/desc 1024)", async () => {
    mocks.fsReadHead.mockResolvedValue(
      `---\nname: ${"x".repeat(80)}\ndescription: ${"d".repeat(2000)}\n---\nbody`,
    );
    const out = await hydrateSkillMeta(base.metaFile!, base);
    expect(out.name).toHaveLength(64);
    expect(out.description).toHaveLength(1024);
  });

  it("frontmatter 缺失回落目录名与正文首行", async () => {
    mocks.fsReadHead.mockResolvedValue("# 标题\n正文");
    const out = await hydrateSkillMeta(base.metaFile!, base);
    expect(out.name).toBe("dir-name");
    expect(out.description).toBe("# 标题");
  });
});

describe("scanAllSkillSources(编排)", () => {
  it("多引擎扫描 + 缺目录引擎隐藏 + 公约位单列组 + 徽标", async () => {
    mocks.fsListDir.mockImplementation(async (dir: string) => {
      if (dir === "/h/.claude/skills") return [entry("pdf", true)];
      if (dir === "/h/.agents/skills") return [entry("brainstorming", true)];
      if (dir === "/h/.codex/skills/.system") return [entry("imagegen", true)];
      throw new Error("不是目录");
    });
    mocks.fsWalkFiles.mockResolvedValue(["pdf/SKILL.md", "brainstorming/SKILL.md", "imagegen/SKILL.md"]);
    const groups = await scanAllSkillSources("/h");
    /* omp/pi/kimi/grok/qoder/opencode/dsh/codex(own)目录缺失 → 隐藏,只剩
       claude / codex(.system)/ shared 三组;分组按目录表序。 */
    expect(groups.map((g) => g.engine)).toEqual(["claude", "codex", "shared"]);
    expect(groups[0].skills[0]).toMatchObject({ name: "pdf", badge: "user", engine: "claude" });
    expect(groups[1].skills[0]).toMatchObject({ name: "imagegen", badge: "system", engine: "codex" });
    expect(groups[2].skills[0]).toMatchObject({
      name: "brainstorming",
      badge: "shared",
      engine: "shared",
    });
  });

  it("codex 双来源同组合并(own + .system)", async () => {
    mocks.fsListDir.mockImplementation(async (dir: string) => {
      if (dir === "/h/.codex/skills") return [entry("mine", true)];
      if (dir === "/h/.codex/skills/.system") return [entry("builtin", true)];
      throw new Error("不是目录");
    });
    mocks.fsWalkFiles.mockResolvedValue([]);
    const groups = await scanAllSkillSources("/h");
    expect(groups).toHaveLength(1);
    expect(groups[0].engine).toBe("codex");
    expect(groups[0].skills.map((s) => s.name)).toEqual(["mine", "builtin"]);
    expect(groups[0].skills.map((s) => s.badge)).toEqual(["user", "system"]);
  });
});

import { describe, expect, it } from "vitest";
import { classifySkillEntry } from "./skillDirs";

describe("classifySkillEntry", () => {
  it("目录式 <name>/SKILL.md(一层)命中", () => {
    expect(classifySkillEntry("lean-ctx/SKILL.md")).toEqual({ name: "lean-ctx", dirName: "lean-ctx" });
  });

  it("平铺 <name>.md 命中(kimi 双形态)", () => {
    expect(classifySkillEntry("brainstorm.md")).toEqual({ name: "brainstorm", dirName: "brainstorm.md" });
  });

  it("技能附属子树(scripts/references)与 SKILL.md 本体不算技能", () => {
    expect(classifySkillEntry("huashu-design/scripts/run.py")).toBeNull();
    expect(classifySkillEntry("huashu-design/references/style.md")).toBeNull();
    expect(classifySkillEntry("SKILL.md")).toBeNull();
    expect(classifySkillEntry(".system/x/SKILL.md")).toBeNull();
  });
});

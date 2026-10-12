import { describe, expect, it } from "vitest";
import { planImportTargets } from "./importPlan";

const HOME = "/Users/u";

describe("planImportTargets", () => {
  it("源即公约位目录:inPlace 免复制,不误报冲突", () => {
    const plan = planImportTargets(
      HOME,
      `${HOME}/.agents/skills/answer-me-with-html`,
      "answer-me-with-html",
      [".agents/skills"],
      { ".agents/skills": ["answer-me-with-html", "brainstorming"] },
    );
    expect(plan).toEqual({ inPlace: [".agents/skills"], copy: [], conflicts: [] });
  });

  it("源在引擎组导回自家目录:同样 inPlace", () => {
    const plan = planImportTargets(
      HOME,
      `${HOME}/.omp/agent/skills/foo/`,
      "foo",
      [".agents/skills", ".omp/agent/skills"],
      { ".agents/skills": ["bar"], ".omp/agent/skills": ["foo"] },
    );
    expect(plan).toEqual({ inPlace: [".omp/agent/skills"], copy: [".agents/skills"], conflicts: [] });
  });

  it("同名已存在且非源:conflicts(先删后导是既定流程)", () => {
    const plan = planImportTargets(
      HOME,
      `${HOME}/.pi/agent/skills/pdf`,
      "pdf",
      [".agents/skills", ".codex/skills"],
      { ".agents/skills": ["pdf"], ".codex/skills": undefined },
    );
    expect(plan).toEqual({ inPlace: [], copy: [".codex/skills"], conflicts: [".agents/skills"] });
  });

  it("父目录不存在(listing undefined)= 空位照常复制", () => {
    const plan = planImportTargets(
      HOME,
      `${HOME}/.claude/skills/new`,
      "new",
      [".dsh/skills"],
      { ".dsh/skills": undefined },
    );
    expect(plan).toEqual({ inPlace: [], copy: [".dsh/skills"], conflicts: [] });
  });
});

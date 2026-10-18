/**
 * 磁盘导入发现契约(纯函数 seam):任意深度 SKILL.md/skill.json 目录识别、
 * README-only 不列、dot 段跳过、同目录双元数据取 skill.json、根目录即技能。
 */
import { describe, expect, it } from "vitest";
import { skillDirsFromWalk } from "./importFromDisk";

describe("skillDirsFromWalk", () => {
  it("根目录自身即技能(平铺 zip:SKILL.md 在选择根)", () => {
    const out = skillDirsFromWalk("/tmp/dl/pdf", ["SKILL.md", "assets/tool.py"]);
    expect(out).toEqual([{ name: "pdf", dir: "/tmp/dl/pdf", metaFile: "/tmp/dl/pdf/SKILL.md" }]);
  });

  it("仓库形状任意深度(GitHub zip 单顶层 + 集合仓库)", () => {
    const out = skillDirsFromWalk("/tmp/x", [
      "repo-main/README.md",
      "repo-main/skills/pdf/SKILL.md",
      "repo-main/skills/xlsx/SKILL.md",
    ]);
    expect(out.map((s) => `${s.name}@${s.dir}`)).toEqual([
      "pdf@/tmp/x/repo-main/skills/pdf",
      "xlsx@/tmp/x/repo-main/skills/xlsx",
    ]);
  });

  it("README-only 目录不列(防 repo 目录噪声)", () => {
    const out = skillDirsFromWalk("/tmp/x", ["docs/README.md", "real/SKILL.md"]);
    expect(out.map((s) => s.name)).toEqual(["real"]);
  });

  it("dot 段跳过", () => {
    const out = skillDirsFromWalk("/tmp/x", [".github/SKILL.md", "ok/SKILL.md"]);
    expect(out.map((s) => s.name)).toEqual(["ok"]);
  });

  it("同目录双元数据取 skill.json", () => {
    const out = skillDirsFromWalk("/tmp/x", ["a/SKILL.md", "a/skill.json"]);
    expect(out).toEqual([{ name: "a", dir: "/tmp/x/a", metaFile: "/tmp/x/a/skill.json" }]);
  });

  it("尾部斜杠归一;同名排序稳定", () => {
    const out = skillDirsFromWalk("/tmp/x/", ["b/SKILL.md", "a/SKILL.md"]);
    expect(out.map((s) => s.name)).toEqual(["a", "b"]);
  });
});

/**
 * omp 学堂数据不变量 —— 目录与课程是长文数据,坏一行不如测试拦一道:
 * 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)与 suggestions 派生面
 * (全量命令、无重复、pinned 语义不变)。
 */

import { describe, expect, it } from "vitest";
import { OMP_ACADEMY_COURSE } from "./academyCatalog";
import { OMP_ACADEMY_LESSONS } from "./academyLessons";
import { OMP_COMMAND_SUGGESTIONS, OMP_SKILL_SUGGESTIONS } from "../index";

describe("omp 学堂目录不变量", () => {
  const commands = OMP_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,章节数据非空", () => {
    expect(OMP_ACADEMY_COURSE.cliId).toBe("omp");
    expect(OMP_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(OMP_ACADEMY_COURSE.chapters.length).toBeGreaterThanOrEqual(8);
    expect(commands.length).toBeGreaterThanOrEqual(80);
  });

  it("命令名全局唯一,示例四段齐备且非空", () => {
    const names = commands.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const c of commands) {
      expect(c.zh.length, c.name).toBeGreaterThan(3);
      expect(c.detail.length, c.name).toBeGreaterThan(30);
      expect(c.examples.length, c.name).toBeGreaterThan(0);
      for (const ex of c.examples) {
        expect(ex.sc.length, c.name).toBeGreaterThan(3);
        expect(ex.i.startsWith("/"), c.name).toBe(true);
        expect(ex.o.length, c.name).toBeGreaterThan(0);
        expect(ex.e.length, c.name).toBeGreaterThan(10);
      }
    }
  });

  it("lessons 覆盖全部章节或以 cheat 收尾,练习命令真实存在于目录", () => {
    expect(OMP_ACADEMY_COURSE.lessons).toEqual(OMP_ACADEMY_LESSONS);
    const names = new Set(commands.map((c) => c.name));
    const last = OMP_ACADEMY_LESSONS.at(-1);
    expect(last?.cheat).toBe(true);
    for (const l of OMP_ACADEMY_LESSONS) {
      expect(l.points.length + (l.cheat ? 1 : 0), l.id).toBeGreaterThan(0);
      if (l.practice) {
        const cmd = l.practice.split(/\s+/)[0].replace(/^\//, "");
        expect(names.has(cmd), `${l.id} 练习 ${cmd}`).toBe(true);
      }
      for (const [cmd] of l.demo ?? []) {
        /* demo 序列允许非命令行(如首课问候);/ 开头的必须是真实目录命令。 */
        if (!cmd.startsWith("/")) continue;
        expect(names.has(cmd.replace(/^\//, "").split(/\s+/)[0]), `${l.id} demo ${cmd}`).toBe(true);
      }
    }
  });
});

describe("composer 命令候选派生", () => {
  it("目录全量入候选,pinned 三条保持原文发送语义且不重复", () => {
    const names = new Set(OMP_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands.map((c) => c.name)));
    const values = OMP_COMMAND_SUGGESTIONS.map((s) => s.value);
    /* 并集语义:目录 82 条 + pinned 独有项(/help 不在 builtin 注册表)。 */
    expect(new Set(values).size).toBe(values.length);
    for (const n of names) expect(values, n).toContain(n);
    for (const p of ["help", "clear", "model"]) expect(values, p).toContain(p);
    expect(values.length).toBe(names.size + 1);
    const pinned = OMP_COMMAND_SUGGESTIONS.filter((s) => ["help", "clear", "model"].includes(s.value));
    expect(pinned.map((s) => s.action)).toEqual(["send", "send", "send"]);
    expect(pinned.map((s) => s.value)).toEqual(["help", "clear", "model"]);
  });

  it("候选描述全部非空,技能候选不受目录影响", () => {
    for (const s of OMP_COMMAND_SUGGESTIONS) expect(s.description?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(OMP_SKILL_SUGGESTIONS.map((s) => s.value)).toEqual(["think", "plan", "review"]);
  });
});

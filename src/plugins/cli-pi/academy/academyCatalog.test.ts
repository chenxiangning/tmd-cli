/**
 * pi 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(22 内置命令与 pi 0.84.1 BUILTIN_SLASH_COMMANDS 集合一致)。
 */

import { describe, expect, it } from "vitest";
import { PI_ACADEMY_COURSE } from "./academyCatalog";
import { PI_ACADEMY_LESSONS } from "./academyLessons";

/** pi 0.84.1 core/slash-commands.ts BUILTIN_SLASH_COMMANDS 的名称集合镜像。 */
const PI_BUILTINS = [
  "settings", "model", "scoped-models", "export", "import", "share", "copy",
  "name", "session", "changelog", "hotkeys", "fork", "clone", "tree", "trust",
  "login", "logout", "new", "compact", "resume", "reload", "quit",
];

describe("pi 学堂目录不变量", () => {
  const commands = PI_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,22 条内置命令全部入册且无缺漏", () => {
    expect(PI_ACADEMY_COURSE.cliId).toBe("pi");
    expect(PI_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    const names = commands.map((c) => c.name);
    for (const b of PI_BUILTINS) expect(names, b).toContain(b);
    const extra = names.filter((n) => !PI_BUILTINS.includes(n));
    expect(extra, "skill: 调用面是目录唯一超集").toEqual(["skill:<name>"]);
  });

  it("命令名全局唯一,示例四段齐备且非空", () => {
    expect(new Set(commands.map((c) => c.name)).size).toBe(commands.length);
    for (const c of commands) {
      expect(c.zh.length, c.name).toBeGreaterThan(3);
      expect(c.detail.length, c.name).toBeGreaterThan(30);
      expect(c.examples.length, c.name).toBeGreaterThan(0);
      for (const ex of c.examples) {
        expect(ex.sc.length, c.name).toBeGreaterThan(4);
        expect(ex.i.startsWith("/"), c.name).toBe(true);
        expect(ex.o.length, c.name).toBeGreaterThan(0);
        expect(ex.e.length, c.name).toBeGreaterThan(10);
      }
    }
  });

  it("lessons 与目录挂载一致,覆盖全部章节并以 cheat 收尾,练习/demo 命令真实存在", () => {
    expect(PI_ACADEMY_COURSE.lessons).toEqual(PI_ACADEMY_LESSONS);
    const chapterIds = new Set(PI_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    for (const l of PI_ACADEMY_LESSONS) {
      if (l.chapter) expect(chapterIds.has(l.chapter), l.id).toBe(true);
      if (l.practice) {
        const cmd = l.practice.split(/\s+/)[0].replace(/^\//, "");
        expect(names.has(cmd), `${l.id} 练习 ${cmd}`).toBe(true);
      }
      for (const [cmd] of l.demo ?? []) {
        if (!cmd.startsWith("/")) continue;
        const name = cmd.replace(/^\//, "").split(/\s+/)[0];
        expect(names.has(name) || name.startsWith("skill:"), `${l.id} demo ${cmd}`).toBe(true);
      }
    }
    expect(PI_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

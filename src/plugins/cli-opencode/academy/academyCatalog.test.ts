/**
 * opencode 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(29 内置斜杠命令与 opencode 1.18.32 二进制注册表集合一致)。
 */

import { describe, expect, it } from "vitest";
import { OPENCODE_ACADEMY_COURSE } from "./academyCatalog";
import { OPENCODE_ACADEMY_LESSONS } from "./academyLessons";

/** opencode 1.18.32 主 TUI 注册表(slashName 组 + slash:{name} 组)的名称集合镜像。 */
const OPENCODE_BUILTINS = [
  "new", "sessions", "models", "agents", "variants", "themes", "org",
  "connect", "debug", "diff", "editor", "exit", "help", "skills", "status",
  "move", "mcps", "timeline", "rename", "fork", "compact", "share",
  "unshare", "undo", "redo", "timestamps", "thinking", "copy", "export",
];

describe("opencode 学堂目录不变量", () => {
  const commands = OPENCODE_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,29 条内置命令全部入册且无缺漏", () => {
    expect(OPENCODE_ACADEMY_COURSE.cliId).toBe("opencode");
    expect(OPENCODE_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    const names = commands.map((c) => c.name);
    expect(commands.length).toBe(OPENCODE_BUILTINS.length);
    for (const b of OPENCODE_BUILTINS) expect(names, b).toContain(b);
    expect(names.filter((n) => !OPENCODE_BUILTINS.includes(n)), "目录与二进制注册表一一对应").toEqual([]);
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
    expect(OPENCODE_ACADEMY_COURSE.lessons).toEqual(OPENCODE_ACADEMY_LESSONS);
    const chapterIds = new Set(OPENCODE_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    for (const l of OPENCODE_ACADEMY_LESSONS) {
      if (l.chapter) expect(chapterIds.has(l.chapter), l.id).toBe(true);
      if (l.practice) {
        const cmd = l.practice.split(/\s+/)[0].replace(/^\//, "");
        expect(names.has(cmd), `${l.id} 练习 ${cmd}`).toBe(true);
      }
      for (const [cmd] of l.demo ?? []) {
        if (!cmd.startsWith("/")) continue;
        const name = cmd.replace(/^\//, "").split(/\s+/)[0];
        expect(names.has(name), `${l.id} demo ${cmd}`).toBe(true);
      }
    }
    expect(OPENCODE_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

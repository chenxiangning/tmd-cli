/**
 * kimi 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(43 条内置命令与 kimi 2.1.1 BUILTIN_SLASH_COMMANDS 集合一致)。
 */

import { describe, expect, it } from "vitest";
import { KIMI_ACADEMY_COURSE } from "./academyCatalog";
import { KIMI_ACADEMY_LESSONS } from "./academyLessons";

/** kimi 2.1.1 tui/commands/registry BUILTIN_SLASH_COMMANDS 的名称集合镜像。 */
const KIMI_BUILTINS = [
  "yolo", "auto", "permission", "settings", "plan", "swarm", "tower",
  "model", "secondary-model", "effort", "provider", "btw", "help", "new",
  "sessions", "tasks", "mcp", "plugins", "add-dir", "experiments", "reload",
  "reload-tui", "compact", "goal", "init", "fork", "title", "usage",
  "status", "feedback", "undo", "editor", "theme", "logout", "login",
  "export-md", "export-debug-zip", "copy", "web", "desktop",
  "remote-control", "exit", "version",
];

describe("kimi 学堂目录不变量", () => {
  const commands = KIMI_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,43 条内置命令全部入册且无缺漏", () => {
    expect(KIMI_ACADEMY_COURSE.cliId).toBe("kimi");
    expect(KIMI_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    const names = commands.map((c) => c.name);
    for (const b of KIMI_BUILTINS) expect(names, b).toContain(b);
    const extra = names.filter((n) => !KIMI_BUILTINS.includes(n));
    expect(extra, "目录与内置注册表应严格一致").toEqual([]);
    expect(commands.length).toBe(KIMI_BUILTINS.length);
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
    expect(KIMI_ACADEMY_COURSE.lessons).toEqual(KIMI_ACADEMY_LESSONS);
    const chapterIds = new Set(KIMI_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    for (const l of KIMI_ACADEMY_LESSONS) {
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
    expect(KIMI_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

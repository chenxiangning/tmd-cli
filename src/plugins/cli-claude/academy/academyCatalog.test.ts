/**
 * claude 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(40 条内置命令与 claude 2.1.282 注册表提取集合一致,提取法见目录头注)。
 */

import { describe, expect, it } from "vitest";
import { CLAUDE_ACADEMY_COURSE } from "./academyCatalog";
import { CLAUDE_ACADEMY_LESSONS } from "./academyLessons";

/** claude 2.1.282 注册表(name+description 直读)收录的命令集合镜像。 */
const CLAUDE_BUILTINS = [
  "clear", "resume", "rename", "recap", "exit",
  "compact", "context", "autocompact", "memory", "init",
  "model", "effort", "advisor", "login", "logout", "usage", "status",
  "config", "theme", "output-style", "statusline", "terminal-setup", "keybindings",
  "permissions", "plan", "security-review", "privacy-settings", "doctor",
  "mcp", "hooks", "plugin", "skills", "reload-plugins", "reload-skills",
  "add-dir", "cd", "export", "copy", "help", "version",
];

describe("claude 学堂目录不变量", () => {
  const commands = CLAUDE_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,40 条内置命令全部入册且无缺漏", () => {
    expect(CLAUDE_ACADEMY_COURSE.cliId).toBe("claude");
    expect(CLAUDE_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    const names = commands.map((c) => c.name);
    for (const b of CLAUDE_BUILTINS) expect(names, b).toContain(b);
    const extra = names.filter((n) => !CLAUDE_BUILTINS.includes(n));
    expect(extra, "隐藏/强制禁用命令一律不收").toEqual([]);
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
    expect(CLAUDE_ACADEMY_COURSE.lessons).toEqual(CLAUDE_ACADEMY_LESSONS);
    const chapterIds = new Set(CLAUDE_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    for (const l of CLAUDE_ACADEMY_LESSONS) {
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
    expect(chapterIds.size, "每章至少被目录承载").toBe(CLAUDE_ACADEMY_COURSE.chapters.length);
    expect(CLAUDE_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

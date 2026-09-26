/**
 * grok 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(31 条命令与 grok 1.0.41 clap 子命令表 + 二进制 strings 斜杠命令
 * 名/相邻描述双证集合一致;描述不明的 /rename /expand /copy /effort 已舍去)。
 */

import { describe, expect, it } from "vitest";
import { GROK_ACADEMY_COURSE } from "./academyCatalog";
import { GROK_ACADEMY_LESSONS } from "./academyLessons";

/** grok 1.0.41 命令名称集合镜像(顶层子命令带 grok 前缀,斜杠命令不带)。 */
const GROK_COMMANDS = [
  // 启动期顶层子命令(grok --help Commands: 表直读)
  "grok login", "grok logout", "grok models", "grok doctor", "grok update",
  // 会话章
  "resume", "rewind", "fork", "delete", "session-info", "jump", "grok sessions",
  // 上下文章
  "plan", "compact", "find", "history", "usage",
  // 扩展章
  "mcps", "grok mcp", "plugins", "config-agents", "hooks", "loop", "workflow",
  // 彩蛋章
  "imagine", "imagine-video", "deep-research", "docs", "help", "release-notes", "quit",
];

describe("grok 学堂目录不变量", () => {
  const commands = GROK_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,31 条命令全部入册且无缺漏", () => {
    expect(GROK_ACADEMY_COURSE.cliId).toBe("grok");
    expect(GROK_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    const names = commands.map((c) => c.name);
    for (const b of GROK_COMMANDS) expect(names, b).toContain(b);
    expect(names.sort()).toEqual([...GROK_COMMANDS].sort());
  });

  it("命令名全局唯一,示例四段齐备且非空", () => {
    expect(new Set(commands.map((c) => c.name)).size).toBe(commands.length);
    for (const c of commands) {
      expect(c.zh.length, c.name).toBeGreaterThan(2);
      expect(c.detail.length, c.name).toBeGreaterThan(30);
      expect(c.examples.length, c.name).toBeGreaterThan(0);
      for (const ex of c.examples) {
        expect(ex.sc.length, c.name).toBeGreaterThan(4);
        expect(ex.i.startsWith("/") || ex.i.startsWith("grok "), c.name).toBe(true);
        expect(ex.o.length, c.name).toBeGreaterThan(0);
        expect(ex.e.length, c.name).toBeGreaterThan(10);
      }
    }
  });

  it("lessons 与目录挂载一致,覆盖全部章节并以 cheat 收尾,练习/demo 命令真实存在", () => {
    expect(GROK_ACADEMY_COURSE.lessons).toEqual(GROK_ACADEMY_LESSONS);
    const chapterIds = new Set(GROK_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    expect(new Set(GROK_ACADEMY_LESSONS.flatMap((l) => (l.chapter ? [l.chapter] : []))).size).toBe(chapterIds.size);
    for (const l of GROK_ACADEMY_LESSONS) {
      if (l.chapter) expect(chapterIds.has(l.chapter), l.id).toBe(true);
      if (l.practice) {
        const stripped = l.practice.replace(/^\//, "");
        const cmd = stripped.startsWith("grok ")
          ? stripped.split(/\s+/).slice(0, 2).join(" ")
          : stripped.split(/\s+/)[0];
        expect(names.has(cmd), `${l.id} 练习 ${cmd}`).toBe(true);
      }
      for (const [cmd] of l.demo ?? []) {
        if (!cmd.startsWith("/") && !cmd.startsWith("grok ")) continue;
        const stripped = cmd.replace(/^\//, "");
        const name = stripped.startsWith("grok ")
          ? stripped.split(/\s+/).slice(0, 2).join(" ")
          : stripped.split(/\s+/)[0];
        expect(names.has(name), `${l.id} demo ${cmd}`).toBe(true);
      }
    }
    expect(GROK_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

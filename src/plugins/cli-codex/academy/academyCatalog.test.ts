/**
 * codex 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(29 条核心命令与 codex 0.157.0 二进制内注册表镜像一致)。
 */

import { describe, expect, it } from "vitest";
import { CODEX_ACADEMY_COURSE } from "./academyCatalog";
import { CODEX_ACADEMY_LESSONS } from "./academyLessons";

/** codex 0.157.0 二进制 TUI 弹层注册表的核心集镜像(官方描述字符串逐一在二进制在场)。 */
const CODEX_CORE_COMMANDS = [
  "new", "resume", "fork", "archive", "rename",
  "compact", "recap", "status", "usage", "diff", "mention", "copy", "export",
  "init", "review", "plan", "goal",
  "model", "permissions", "mcp", "skills", "theme", "vim", "logout", "quit",
  "agents", "side", "worktree", "ps",
];

describe("codex 学堂目录不变量", () => {
  const commands = CODEX_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与真源版本声明齐备,29 条核心命令全部入册且无超集", () => {
    expect(CODEX_ACADEMY_COURSE.cliId).toBe("codex");
    expect(CODEX_ACADEMY_COURSE.sourceVersion).toBe("0.157.0");
    const names = commands.map((c) => c.name);
    for (const b of CODEX_CORE_COMMANDS) expect(names, b).toContain(b);
    expect(names.length).toBe(CODEX_CORE_COMMANDS.length);
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
    expect(CODEX_ACADEMY_COURSE.lessons).toEqual(CODEX_ACADEMY_LESSONS);
    const chapterIds = new Set(CODEX_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const covered = new Set(CODEX_ACADEMY_LESSONS.map((l) => l.chapter).filter(Boolean));
    for (const id of chapterIds) expect(covered.has(id), `章节 ${id} 有课覆盖`).toBe(true);
    const names = new Set(commands.map((c) => c.name));
    for (const l of CODEX_ACADEMY_LESSONS) {
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
    expect(CODEX_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

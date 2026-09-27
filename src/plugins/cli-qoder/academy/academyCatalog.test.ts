/**
 * Qoder 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程双向覆盖收尾)
 * 与真源对账(38 条命令与 qodercli 1.1.63 提取集合一致,提取法见 academyCatalog 头注)。
 */

import { describe, expect, it } from "vitest";
import { QODER_ACADEMY_COURSE } from "./academyCatalog";
import { QODER_ACADEMY_LESSONS } from "./academyLessons";

/** qodercli 1.1.63 真源命令名集合镜像:斜杠注册表 30 条 + shell 子命令 8 条。 */
const QODER_TRUTH = [
  // 会话内斜杠命令(二进制 {name,description} 注册表)
  "new", "continue", "resume", "rename", "branch", "clear", "export", "copy",
  "init", "compact", "context", "memory", "add-dir",
  "model", "effort", "fast", "context-window", "output-style", "theme", "vim",
  "plan", "review", "diff", "btw", "subtask",
  "mcp", "skills", "hooks", "agents", "commands",
  // 终端子命令(qodercli --help 注册表)
  "login", "update", "rollback", "status", "usage", "commit", "security", "wiki",
];

/** 卡片名:斜杠命令与 shell 子命令统一用裸名;练习/demo 行首据此还原。 */
function commandNameOf(line: string): string {
  const tokens = line.split(/\s+/);
  return tokens[0] === "qodercli" ? tokens[1] : tokens[0].replace(/^\//, "");
}

describe("qoder 学堂目录不变量", () => {
  const commands = QODER_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与实测版本声明齐备,38 条真源命令全部入册且无超集", () => {
    expect(QODER_ACADEMY_COURSE.cliId).toBe("qoder");
    expect(QODER_ACADEMY_COURSE.sourceVersion).toBe("1.1.63");
    const names = commands.map((c) => c.name);
    expect(new Set(names).size, "命令名全局唯一").toBe(names.length);
    expect([...names].sort()).toEqual([...QODER_TRUTH].sort());
  });

  it("示例四段齐备且输入面与会话内/终端两种形态匹配", () => {
    for (const c of commands) {
      expect(c.zh.length, c.name).toBeGreaterThan(3);
      expect(c.detail.length, c.name).toBeGreaterThan(30);
      expect(c.examples.length, c.name).toBeGreaterThan(0);
      for (const ex of c.examples) {
        expect(ex.sc.length, c.name).toBeGreaterThan(4);
        expect(
          ex.i.startsWith("/") || ex.i.startsWith("qodercli "),
          c.name,
        ).toBe(true);
        expect(ex.o.length, c.name).toBeGreaterThan(0);
        expect(ex.e.length, c.name).toBeGreaterThan(10);
      }
    }
  });

  it("lessons 与目录挂载一致,双向覆盖全部章节并以 cheat 收尾,练习/demo 命令真实存在", () => {
    expect(QODER_ACADEMY_COURSE.lessons).toEqual(QODER_ACADEMY_LESSONS);
    const chapterIds = new Set(QODER_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    const covered = new Set<string>();
    for (const l of QODER_ACADEMY_LESSONS) {
      if (l.chapter) {
        expect(chapterIds.has(l.chapter), l.id).toBe(true);
        covered.add(l.chapter);
      }
      if (l.practice) {
        const cmd = commandNameOf(l.practice);
        expect(names.has(cmd), `${l.id} 练习 ${cmd}`).toBe(true);
      }
      for (const [cmd] of l.demo ?? []) {
        if (!cmd.startsWith("/")) continue;
        expect(names.has(commandNameOf(cmd)), `${l.id} demo ${cmd}`).toBe(true);
      }
    }
    expect(covered, "每章都有对应课程").toEqual(chapterIds);
    expect(QODER_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

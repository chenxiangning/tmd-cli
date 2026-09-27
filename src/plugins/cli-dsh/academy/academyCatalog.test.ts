/**
 * dsh 学堂数据不变量 —— 结构完整性(示例四段齐/章节命令唯一/课程覆盖收尾)
 * 与真源对账(7 条注册命令与 dsh 0.1.5-rc.1 包内 commands.register /
 * command.register 注册表集合一致)。
 */

import { describe, expect, it } from "vitest";
import { DSH_ACADEMY_COURSE } from "./academyCatalog";
import { DSH_ACADEMY_LESSONS } from "./academyLessons";

/** dsh 0.1.5-rc.1 包内斜杠命令注册表名称集合镜像(dsh-command-* / dsh-*-ui-* 各注册点)。 */
const DSH_BUILTINS = [
  "model", "permission", "plan", "goal", "compact", "export", "feedback",
];

describe("dsh 学堂目录不变量", () => {
  const commands = DSH_ACADEMY_COURSE.chapters.flatMap((ch) => ch.commands);

  it("cliId 与版本声明齐备,7 条注册命令全部入册且无超集", () => {
    expect(DSH_ACADEMY_COURSE.cliId).toBe("dsh");
    expect(DSH_ACADEMY_COURSE.sourceVersion).toMatch(/^\d+\.\d+\.\d+/);
    const names = commands.map((c) => c.name);
    for (const b of DSH_BUILTINS) expect(names, b).toContain(b);
    const extra = names.filter((n) => !DSH_BUILTINS.includes(n));
    expect(extra, "注册表之外不收录任何命令").toEqual([]);
    expect(names).toHaveLength(DSH_BUILTINS.length);
  });

  it("命令名全局唯一,官方描述收录,示例四段齐备且非空", () => {
    expect(new Set(commands.map((c) => c.name)).size).toBe(commands.length);
    for (const c of commands) {
      expect(c.en?.length, c.name).toBeGreaterThan(8);
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
    expect(DSH_ACADEMY_COURSE.lessons).toEqual(DSH_ACADEMY_LESSONS);
    const chapterIds = new Set(DSH_ACADEMY_COURSE.chapters.map((ch) => ch.id));
    const names = new Set(commands.map((c) => c.name));
    for (const l of DSH_ACADEMY_LESSONS) {
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
    expect(DSH_ACADEMY_LESSONS.at(-1)?.cheat).toBe(true);
  });
});

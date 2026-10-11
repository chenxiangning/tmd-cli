/** docgen 解析器测试(五段提取/src 注释/等级与负责人截取/回落/diff 键)。 */
import { describe, expect, it } from "vitest";
import { diffParsed, parseDocGenMarkdown } from "./parse";

const GOOD = `# 周报 · 本周

## 概览
- 整体进度 62% → 71%
- 活跃风险 4 个

## 项目进展
### 天穹客户端
- 进度:68%
- 设置页验收通过

### 数据网关
- 进度:55%

## 风险与阻塞
- 高:灰度环境 P95 恶化至 812ms <!--src:进展 2026-10-02-->
- 中:移动端崩溃率超门槛
- 无

## 行动项
- [ ] 网关降级预案评审(负责人:陈鹏,截止:2026-10-13) <!--src:会话 10-08-->
- [x] 回捞崩溃堆栈
- 无

## 建议
- 灰度发布后移 2 天
  依据:风险 #1 未闭环
`;

describe("parseDocGenMarkdown", () => {
  it("五段全解析:风险等级/溯源/负责人/截止/依据", () => {
    const p = parseDocGenMarkdown(GOOD);
    expect(p).not.toBeNull();
    expect(p!.overview).toHaveLength(2);
    expect(p!.projects.map((x) => x.name)).toEqual(["天穹客户端", "数据网关"]);
    expect(p!.risks).toHaveLength(2);
    expect(p!.risks[0]).toMatchObject({ level: "高", text: "灰度环境 P95 恶化至 812ms", src: "进展 2026-10-02" });
    expect(p!.actions[0]).toMatchObject({ text: "网关降级预案评审", owner: "陈鹏", due: "2026-10-13", src: "会话 10-08" });
    expect(p!.actions[1].text).toBe("回捞崩溃堆栈");
    expect(p!.suggestions[0]).toMatchObject({ text: "灰度发布后移 2 天", basis: "风险 #1 未闭环" });
  });

  it("缺段/无风险无行动 → 回落 null(原文渲染)", () => {
    expect(parseDocGenMarkdown("# 只有标题\n正文一段")).toBeNull();
    const stripped = GOOD
      .replace("- 高:灰度环境 P95 恶化至 812ms <!--src:进展 2026-10-02-->\n", "")
      .replace("- 中:移动端崩溃率超门槛\n", "")
      .replace("- [ ] 网关降级预案评审(负责人:陈鹏,截止:2026-10-13) <!--src:会话 10-08-->\n", "")
      .replace("- [x] 回捞崩溃堆栈\n", "");
    expect(parseDocGenMarkdown(stripped)).toBeNull();
  });

  it("段标题变体「各项目进展」可识别;半角括号与空格同样截取", () => {
    const md = GOOD.replace("## 项目进展", "## 各项目进展")
      .replace("- [ ] 网关降级预案评审(负责人:陈鹏,截止:2026-10-13)", "- [ ] 网关降级预案评审 (负责人: Chen, 截止: 2026-10-13)");
    const p = parseDocGenMarkdown(md)!;
    expect(p.projects).toHaveLength(2);
    expect(p.actions[0].owner).toBe("Chen");
    expect(p.actions[0].due).toBe("2026-10-13");
  });
});

describe("diffParsed", () => {
  it("增/删/改按字母骨架判键(数字变动不算改)", () => {
    const prev = parseDocGenMarkdown(GOOD)!;
    const curMd = GOOD
      .replace("灰度环境 P95 恶化至 812ms", "灰度环境 P95 恶化至 900ms") /* 同键,数值变 → mod */
      .replace("- 中:移动端崩溃率超门槛\n", "") /* 消除 → del */
      .replace("- 灰度发布后移 2 天", "- 新增:稳定性专项立项"); /* 建议 + 数字变 → mod? 键不同 → add */
    const cur = parseDocGenMarkdown(curMd)!;
    const items = diffParsed(prev, cur);
    const signs = items.map((i) => i.sign);
    expect(signs).toContain("mod");
    expect(signs).toContain("del");
    expect(signs).toContain("add");
    expect(items.find((i) => i.sign === "mod")!.text).toContain("900ms");
  });
});

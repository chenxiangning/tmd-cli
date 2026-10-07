/** prompt 构造测试(md 契约钉死:结构/半角/增量规则/摘录来源/会话清单)。 */
import { describe, expect, it } from "vitest";
import { buildGenPrompt } from "./promptGen";
import type { DaySessionRow } from "./daySessions";

const row = (iso: string, profileId = "omp", title = "mermaid 渲染", id?: string): DaySessionRow => ({
  profileId,
  title,
  id,
  startedAt: new Date(iso).getTime(),
  modifiedAt: new Date(iso).getTime(),
  live: false,
  wsName: "demo",
});
const handoff = { path: "/dj/digest/2026-09-29.md", coveredIds: ["s1"] };

describe("buildGenPrompt", () => {
  it("全新生成:路径/结构/半角纪律/会话清单在位", () => {
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T09:30:00")], false, "/dj/article/2026-09-29.md");
    expect(p).toContain("/dj/article/2026-09-29.md");
    expect(p).toContain("# 每日工作日志生成任务:2026-09-29");
    expect(p).toContain("## 未完事项");
    expect(p).toContain("文件尚不存在:全新生成");
    expect(p).toContain("[omp] mermaid 渲染 · demo"); /* ws 以 · 隔离,标题边界干净(引用标记四段契约) */
    /* 标题提取指令须剔除行内标注:主路径每行都带 (有摘录)/(无摘录),不剔会系统性失配降级 */
    expect(p).toContain("剔除行尾 (有摘录)/(无摘录)/(已归纳)/(新增) 标注");
    expect(p).toContain("只写这一个文件");
    expect(p).toContain("立即降级:仅凭清单成文");
    expect(p).toContain("只回复一行:已写入");
  });

  it("四点式契约:问题/过程/关键片段/踩坑与规避逐项在位", () => {
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T09:30:00", "omp", "mermaid 渲染", "s1")], false, "/dj/a.md", undefined, handoff);
    expect(p).toContain("解决了什么问题");
    expect(p).toContain("解决过程");
    expect(p).toContain("关键片段");
    expect(p).toContain("踩坑与规避");
    expect(p).toContain("下次避免:");
    expect(p).toContain("> 引用摘录原文");
    expect(p).toContain("禁止编造");
  });

  it("有摘录:摘录文件为事实来源 + 行级按收录实标 + 专属降级条款", () => {
    const p = buildGenPrompt(
      2026,
      9,
      29,
      [row("2026-09-29T09:30:00", "omp", "mermaid 渲染", "s1"), row("2026-09-29T10:00:00", "grok", "无适配器行", "s2")],
      false,
      "/dj/a.md",
      undefined,
      handoff,
    );
    expect(p).toContain("先完整读入会话内容摘录");
    expect(p).toContain("/dj/digest/2026-09-29.md");
    expect(p).toContain("摘录文件读取失败才降级");
    /* 行级标注按 coveredIds 实标:s1 收录 → (有摘录);s2(grok 无转录适配器)→ (无摘录)。 */
    expect(p).toContain("[omp] mermaid 渲染(有摘录) · demo");
    expect(p).toContain("[grok] 无适配器行(无摘录) · demo");
  });

  it("无摘录:清单降级 + 行无摘录标注", () => {
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T09:30:00")], false, "/dj/a.md");
    expect(p).not.toContain("先完整读入会话内容摘录");
    /* 行级标注不出现(指令句中的标注枚举除外,故按行形态断言): */
    expect(p).not.toContain("mermaid 渲染(有摘录)");
    expect(p).not.toContain("mermaid 渲染(无摘录)");
    expect(p).toContain("立即降级:仅凭清单成文");
  });

  it("增量:既有节不重写 + 半角并入留痕指令", () => {
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T13:00:00")], true, "/dj/article/2026-09-29.md");
    expect(p).toContain("逐字保留全部既有节");
    expect(p).toContain("(15:32 并入)");
    expect(p).not.toContain("文件尚不存在");
  });

  it("水位标注:已归纳仅上下文/新增成节,无水位不标", () => {
    const at = new Date("2026-09-29T12:00:00").getTime();
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T09:00:00"), row("2026-09-29T15:00:00")], true, "/dj/article/2026-09-29.md", at);
    expect(p).toContain("(已归纳)");
    expect(p).toContain("(新增)");
    expect(p).toContain("(已归纳)的仅作上下文、不得为其新增节");
    const noMark = buildGenPrompt(2026, 9, 29, [row("2026-09-29T09:00:00")], true, "/dj/article/2026-09-29.md");
    expect(noMark).not.toContain("mermaid 渲染(已归纳)");
    expect(noMark).not.toContain("mermaid 渲染(新增)");
  });

  it("增量 + 摘录:来源声明只含新增会话,已归纳以既有文章为准", () => {
    const at = new Date("2026-09-29T12:00:00").getTime();
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T15:00:00", "omp", "新会话", "s2")], true, "/dj/a.md", at, handoff);
    expect(p).toContain("先完整读入会话内容摘录(只含标注(新增)的会话");
    expect(p).toContain("已归纳会话以既有文章为准");
    expect(p).not.toContain("每个会话的用户原话");
  });

  it("空会话日:清单降级说明", () => {
    const p = buildGenPrompt(2026, 9, 22, [], false, "/dj/article/2026-09-22.md");
    expect(p).toContain("无——按空日处理");
  });
});

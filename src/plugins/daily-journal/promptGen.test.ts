/** prompt 构造测试(md 契约钉死:结构/半角/增量规则/会话清单)。 */
import { describe, expect, it } from "vitest";
import { buildGenPrompt } from "./promptGen";
import type { DaySessionRow } from "./daySessions";

const row = (iso: string, profileId = "omp", title = "mermaid 渲染"): DaySessionRow => ({
  profileId,
  title,
  startedAt: new Date(iso).getTime(),
  modifiedAt: new Date(iso).getTime(),
  live: false,
  wsName: "demo",
});

describe("buildGenPrompt", () => {
  it("全新生成:路径/结构/半角纪律/会话清单在位", () => {
    const p = buildGenPrompt(2026, 9, 29, [row("2026-09-29T09:30:00")], false, "/dj/article/2026-09-29.md");
    expect(p).toContain("/dj/article/2026-09-29.md");
    expect(p).toContain("# 每日工作日志生成任务:2026-09-29");
    expect(p).toContain("## 未完事项");
    expect(p).toContain("文件尚不存在:全新生成");
    expect(p).toContain("[omp] mermaid 渲染(demo)");
    expect(p).toContain("只写这一个文件");
    expect(p).toContain("立即降级:仅凭上面清单成文");
    expect(p).toContain("只回复一行:已写入");
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
    expect(noMark).not.toContain("(已归纳)");
    expect(noMark).not.toContain("(新增)");
  });

  it("空会话日:清单降级说明", () => {
    const p = buildGenPrompt(2026, 9, 22, [], false, "/dj/article/2026-09-22.md");
    expect(p).toContain("无——按空日处理");
  });
});

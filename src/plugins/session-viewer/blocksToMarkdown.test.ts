/**
 * blocksToMarkdown 全分支契约测试(候选7;node 纯函数):
 * 角色映射(user/assistant/tool)、过程块与图片跳过计数、truncated 头部标注、
 * 空 blocks 仅头部、标题缺省回会话 id;sessionExportFileName 的 slug/日期/
 * Windows 保留名清洗(docgen/paths safeFileBase 复用面)。
 */
import { describe, expect, it } from "vitest";
import { blocksToMarkdown, sessionExportFileName } from "./blocksToMarkdown";

const META = { title: "会话标题", cliSessionId: "sess-1", profileId: "claude", exportedAt: new Date(2026, 9, 18, 16, 51).getTime() };

describe("blocksToMarkdown", () => {
  it("user/assistant 映射二级标题,块间空行,元信息行含引擎/导出时间/块数", () => {
    const out = blocksToMarkdown(
      { blocks: [
        { id: "u1", role: "user", text: "你好" },
        { id: "a1", role: "assistant", text: "答复正文" },
      ] },
      META,
    );
    expect(out.markdown).toBe(
      [
        "# 会话标题",
        "引擎 claude · 导出时间 2026-10-18 16:51 · 块数 2",
        "## 用户\n\n你好",
        "## 助手\n\n答复正文",
      ].join("\n\n"),
    );
    expect(out).toMatchObject({ blocks: 2, skippedThinking: 0, skippedImages: 0 });
  });

  it("tool 块折叠一行引用,正文不导出但计入块数;无名工具回退 tool", () => {
    const out = blocksToMarkdown(
      { blocks: [
        { id: "t1", role: "tool", text: "", tool: { title: "bash" } },
        { id: "t2", role: "tool", text: "预览文本" },
      ] },
      META,
    );
    expect(out.markdown).toContain("> [工具] bash");
    expect(out.markdown).toContain("> [工具] tool");
    expect(out.markdown).not.toContain("预览文本");
    expect(out.blocks).toBe(2);
  });

  it("reasoning/system 跳过并计数;user 内嵌图片跳过计数且文本照常导出", () => {
    const out = blocksToMarkdown(
      { blocks: [
        { id: "r1", role: "reasoning", text: "思考过程" },
        { id: "s1", role: "system", text: "notice" },
        { id: "u1", role: "user", text: "看图", images: [
          { mimeType: "image/png", data: "aaa" },
          { mimeType: "image/jpeg", data: "bbb" },
        ] },
      ] },
      META,
    );
    expect(out.markdown).not.toContain("思考过程");
    expect(out.markdown).toContain("## 用户");
    expect(out).toMatchObject({ blocks: 1, skippedThinking: 2, skippedImages: 2 });
  });

  it("truncated 时头部标注截断版;未截断无标注", () => {
    const yes = blocksToMarkdown({ blocks: [], truncated: true }, META);
    expect(yes.markdown).toContain("> 源超预算,导出为截断版");
    const no = blocksToMarkdown({ blocks: [] }, META);
    expect(no.markdown).not.toContain("截断");
  });

  it("空 blocks:仅头部,计数全零", () => {
    const out = blocksToMarkdown({ blocks: [] }, META);
    expect(out.markdown).toBe(
      ["# 会话标题", "引擎 claude · 导出时间 2026-10-18 16:51 · 块数 0"].join("\n\n"),
    );
    expect(out).toMatchObject({ blocks: 0, skippedThinking: 0, skippedImages: 0 });
  });

  it("标题缺省回会话 id", () => {
    const out = blocksToMarkdown(
      { blocks: [] },
      { cliSessionId: "sess-9", profileId: "omp" },
    );
    expect(out.markdown.startsWith("# sess-9")).toBe(true);
  });
});

describe("sessionExportFileName", () => {
  const DAY = new Date(2026, 9, 18);

  it("slug 替换文件系统非法字符,尾接 YYYYMMDD", () => {
    expect(sessionExportFileName("我的 会话:标题", "sess-1", DAY)).toBe("我的 会话_标题-20261018.md");
  });

  it("Windows 保留设备名命中加主干前缀 _(safeFileBase 复用;含保留名+扩展名形态)", () => {
    expect(sessionExportFileName("CON", "sess-1", DAY)).toBe("_CON-20261018.md");
    expect(sessionExportFileName("CON.md", "sess-1", DAY)).toBe("_CON.md-20261018.md");
    expect(sessionExportFileName("普通标题", "sess-1", DAY)).toBe("普通标题-20261018.md");
  });

  it("标题缺省回会话 id;超长标题封顶 80 字符", () => {
    expect(sessionExportFileName(undefined, "sess-1", DAY)).toBe("sess-1-20261018.md");
    const long = "长".repeat(120);
    const name = sessionExportFileName(long, "sess-1", DAY);
    expect(name).toBe(`${"长".repeat(80)}-20261018.md`);
  });
});

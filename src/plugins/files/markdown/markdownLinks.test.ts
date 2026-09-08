/**
 * markdown 链接分流契约测试 —— 覆盖 resolveMarkdownLinkTarget 的本地路径解析
 * (相对/绝对/file:///%20 解码/锚点与 query 切分/非本地 scheme 拒绝)与
 * normalizeMarkdownAnchorKey 的锚点-标题宽松匹配。
 * 「点击不触发 webview 默认导航」由 useMarkdownComponents 组件层保证,不在本表。
 */
import { describe, expect, it } from "vitest";
import { resolveMarkdownLinkTarget } from "./markdownImages";
import { normalizeMarkdownAnchorKey } from "./markdownPreviewHelpers";

describe("resolveMarkdownLinkTarget", () => {
  const source = "/ws/docs/README.md";

  it("相对链接以源文件 dirname 解析", () => {
    expect(resolveMarkdownLinkTarget("./a/b.md", source)?.path).toBe("/ws/docs/a/b.md");
    expect(resolveMarkdownLinkTarget("../img/x.png", source)?.path).toBe("/ws/img/x.png");
    expect(resolveMarkdownLinkTarget("2026-09-01-启动.md", source)?.path).toBe(
      "/ws/docs/2026-09-01-启动.md",
    );
  });

  it("绝对路径与 file:// 直用", () => {
    expect(resolveMarkdownLinkTarget("/tmp/x.md", source)?.path).toBe("/tmp/x.md");
    expect(resolveMarkdownLinkTarget("file:///Users/a/b.md", source)?.path).toBe("/Users/a/b.md");
    expect(resolveMarkdownLinkTarget("file://localhost/Users/a/b.md")?.path).toBe("/Users/a/b.md");
  });

  it("盘符路径不误判为 scheme", () => {
    expect(resolveMarkdownLinkTarget("C:\\docs\\a.md")?.path).toBe("C:\\docs\\a.md");
    expect(resolveMarkdownLinkTarget("C:/docs/a.md")?.path).toBe("C:/docs/a.md");
  });

  it("%20 解码,锚点与 query 正确切分", () => {
    const target = resolveMarkdownLinkTarget("./my%20file.md?x=1#sec-1", source);
    expect(target?.path).toBe("/ws/docs/my file.md");
    expect(target?.anchor).toBe("sec-1");
    const angled = resolveMarkdownLinkTarget("<./2026 报告.md#结论>", source);
    expect(angled?.path).toBe("/ws/docs/2026 报告.md");
    expect(angled?.anchor).toBe("结论");
    expect(resolveMarkdownLinkTarget("./a.md", source)?.anchor).toBe("");
  });

  it("非本地目标返回 null(javascript:/vscode:/纯锚点/空)", () => {
    expect(resolveMarkdownLinkTarget("javascript:alert(1)", source)).toBeNull();
    expect(resolveMarkdownLinkTarget("vscode://file/tmp/x", source)).toBeNull();
    expect(resolveMarkdownLinkTarget("#sec", source)).toBeNull();
    expect(resolveMarkdownLinkTarget("", source)).toBeNull();
  });
});

describe("normalizeMarkdownAnchorKey", () => {
  it("GitHub 风格 slug 与标题直书互相匹配", () => {
    expect(normalizeMarkdownAnchorKey("composer-工具栏设计")).toBe(
      normalizeMarkdownAnchorKey("Composer 工具栏设计"),
    );
    expect(normalizeMarkdownAnchorKey("%E5%9F%BA%E7%A1%80%E6%9E%B6%E6%9E%84%E6%80%BB%E8%A7%88")).toBe(
      normalizeMarkdownAnchorKey("基础架构总览"),
    );
    expect(normalizeMarkdownAnchorKey("代码级架构(Mermaid)")).toBe(
      normalizeMarkdownAnchorKey("代码级架构mermaid"),
    );
  });

  it("不同标题不误配", () => {
    expect(normalizeMarkdownAnchorKey("基础架构总览")).not.toBe(
      normalizeMarkdownAnchorKey("基础架构概览"),
    );
  });
});

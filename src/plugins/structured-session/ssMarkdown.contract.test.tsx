/** RPC 幕布标签清洗契约 —— 2026-11-06 用户实证:omp 上下文标签(§数字§)泄漏
 * 进模型输出并粘在栅栏开场同行(`§20§ ```sql`),栅栏非行首不成码块,整段
 * SQL 裸文直排。钉死两条:stripCtxTags 剥标签后栅栏回到行首;剥净的正文过
 * 真 md 管线渲染出 language-sql 码块(生产组合 = SsMarkdown = strip∘MarkdownBody,
 * lazy 注入件不便 SSR,此处以同组合直证)。 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "@plugins/session-viewer/markdownBody";
import { stripCtxTags } from "./ssCtxTags";

describe("stripCtxTags(omp 上下文标签清洗)", () => {
  it("粘栅栏的标签剥净,栅栏回到行首", () => {
    expect(stripCtxTags("§20§ ```sql\nSELECT 1;\n```")).toBe("```sql\nSELECT 1;\n```");
  });
  it("连续标签与行中标签逐个剥,至多带一个尾随空格", () => {
    expect(stripCtxTags("§17§§18§ ```py")).toBe("```py");
    expect(stripCtxTags("见 §17§,下一步")).toBe("见,下一步");
  });
  it("无标签正文零改动(含 § 单字符与换行边界)", () => {
    const plain = "正常 **md** 正文\n```sql\nSELECT 1;\n```\n§ 见下节";
    expect(stripCtxTags(plain)).toBe(plain);
  });
});

describe("剥净后栅栏按 md 渲染(生产组合同形)", () => {
  it("标签剥离的 sql 栅栏渲染出 language-sql 码块,标签不再上屏", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownBody, { children: stripCtxTags("§20§ ```sql\nSELECT 1;\n```") }),
    );
    expect(html).toContain("language-sql");
    expect(html).not.toContain("§20§");
    expect(html).toContain("<pre>");
  });
});

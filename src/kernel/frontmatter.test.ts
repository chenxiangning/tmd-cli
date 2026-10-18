import { describe, expect, it } from "vitest";
import { frontmatterDescription, parseFrontmatter } from "@kernel/frontmatter";

describe("parseFrontmatter", () => {
  it("单行 key: value 与引号剥离(claude open-spec 实证形态)", () => {
    const { fields } = parseFrontmatter(
      '---\nname: "open-spec:new"\ndescription: Open a spec\ndisable-model-invocation: true\n---\n正文',
    );
    expect(fields.name).toBe("open-spec:new");
    expect(fields.description).toBe("Open a spec");
    expect(fields["disable-model-invocation"]).toBe("true");
  });

  it("无 frontmatter = 空 fields + 正文首行回落", () => {
    const r = parseFrontmatter("\n\n首行描述\n");
    expect(r.fields).toEqual({});
    expect(r.firstBodyLine).toBe("首行描述");
  });

  it("头残缺(无闭合 ---)不挂死", () => {
    const r = parseFrontmatter("---\nname: x\n无闭合");
    expect(Object.keys(r.fields)).toContain("name");
  });

  it("折叠块标量 >-:段内换行并空格,空行成段界(answer-me-with-html 实证形态)", () => {
    const { fields } = parseFrontmatter(
      "---\nname: a\ndescription: >-\n  第一行折行\n  续行同段。\n\n  第二段。\n---\n正文",
    );
    expect(fields.description).toBe("第一行折行 续行同段。\n第二段。");
  });

  it("字面块标量 |:保留换行;块标量后接其他 key 正常续解析", () => {
    const { fields } = parseFrontmatter(
      "---\ndescription: |\n  行一\n  行二\nname: b\n---\n正文",
    );
    expect(fields.description).toBe("行一\n行二");
    expect(fields.name).toBe("b");
  });

  it("块标量在 frontmatter 闭合处正确终止", () => {
    const { fields, firstBodyLine } = parseFrontmatter(
      "---\ndescription: >\n  折叠描述\n---\n\n首行\n",
    );
    expect(fields.description).toBe("折叠描述");
    expect(firstBodyLine).toBe("首行");
  });
});

describe("frontmatterDescription", () => {
  it("description 缺省回落正文首行(各家权威回落语义)", () => {
    expect(frontmatterDescription("---\nname: a\n---\n\n回落行\n")).toBe("回落行");
    expect(frontmatterDescription("---\ndescription: 显式\n---\n正文\n")).toBe("显式");
    expect(frontmatterDescription("")).toBeUndefined();
  });
});

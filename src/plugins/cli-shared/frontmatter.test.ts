import { describe, expect, it } from "vitest";
import { frontmatterDescription, parseFrontmatter } from "./frontmatter";

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
});

describe("frontmatterDescription", () => {
  it("description 缺省回落正文首行(各家权威回落语义)", () => {
    expect(frontmatterDescription("---\nname: a\n---\n\n回落行\n")).toBe("回落行");
    expect(frontmatterDescription("---\ndescription: 显式\n---\n正文\n")).toBe("显式");
    expect(frontmatterDescription("")).toBeUndefined();
  });
});

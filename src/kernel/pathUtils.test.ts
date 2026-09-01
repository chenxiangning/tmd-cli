/**
 * 路径工具契约测试。
 * 覆盖:normalizePath 分隔符归一/去尾部、baseName 双分隔符末段提取、
 * deriveWorkspaceName 语义、pathsEqual 大小写敏感/不敏感两态。
 */
import { describe, expect, it } from "vitest";
import { baseName, deriveWorkspaceName, normalizePath, pathsEqual } from "./pathUtils";

describe("normalizePath", () => {
  it("反斜杠归一为正斜杠", () => {
    expect(normalizePath("C:\\Users\\x\\repo")).toBe("C:/Users/x/repo");
  });

  it("去掉尾部分隔符", () => {
    expect(normalizePath("/repo/demo/")).toBe("/repo/demo");
    expect(normalizePath("C:\\repo\\demo\\")).toBe("C:/repo/demo");
  });

  it("POSIX 根路径保持 '/'", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("连续尾部分隔符全部去掉", () => {
    expect(normalizePath("/a/b///")).toBe("/a/b");
  });
});

describe("baseName", () => {
  it("POSIX 路径取末段", () => {
    expect(baseName("/Users/x/CCGUI")).toBe("CCGUI");
  });

  it("Windows 路径取末段", () => {
    expect(baseName("C:\\Users\\x\\repo")).toBe("repo");
  });

  it("混合分隔符取末段", () => {
    expect(baseName("C:/Users\\x/repo")).toBe("repo");
  });

  it("尾部分隔符不影响末段提取", () => {
    expect(baseName("/repo/demo/")).toBe("demo");
  });

  it("无分隔符时返回原串", () => {
    expect(baseName("demo")).toBe("demo");
  });

  it("空末段时回退原路径", () => {
    expect(baseName("")).toBe("");
  });
});

describe("deriveWorkspaceName", () => {
  it("工作区显示名 = 根目录末段", () => {
    expect(deriveWorkspaceName("/repo/demo")).toBe("demo");
    expect(deriveWorkspaceName("D:\\work\\proj")).toBe("proj");
  });
});

describe("pathsEqual", () => {
  it("分隔符差异视为相等", () => {
    expect(pathsEqual("C:\\a\\b", "C:/a/b", false)).toBe(true);
  });

  it("尾部分隔符差异视为相等", () => {
    expect(pathsEqual("/a/b/", "/a/b", false)).toBe(true);
  });

  it("大小写敏感模式:大小写不同即不等", () => {
    expect(pathsEqual("/Repo/Demo", "/repo/demo", false)).toBe(false);
  });

  it("大小写不敏感模式:大小写不同仍相等", () => {
    expect(pathsEqual("/Repo/Demo", "/repo/demo", true)).toBe(true);
  });

  it("不同路径任何模式都不等", () => {
    expect(pathsEqual("/a/b", "/a/c", true)).toBe(false);
  });
});

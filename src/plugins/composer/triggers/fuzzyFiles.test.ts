import { describe, expect, it } from "vitest";
import { fuzzyFileMatch, fuzzyFileScore } from "./fuzzyFiles";

describe("fuzzyFileScore", () => {
  it("子序列命中;不命中返回 null", () => {
    expect(fuzzyFileScore("src/app-shell/index.tsx", "aindx")).not.toBeNull();
    expect(fuzzyFileScore("src/app-shell/index.tsx", "zzz")).toBeNull();
  });

  it("smart-case:大写 needle 强制精确匹配", () => {
    expect(fuzzyFileScore("README.md", "RM")).not.toBeNull();
    expect(fuzzyFileScore("readme.md", "RM")).toBeNull();
    expect(fuzzyFileScore("readme.md", "rm")).not.toBeNull();
  });

  it("basename 命中优于路径散布命中", () => {
    const base = fuzzyFileScore("src/fs/index.ts", "ind")!;
    const scattered = fuzzyFileScore("src/i/n/d/ex.ts", "ind")!;
    expect(base).toBeGreaterThan(scattered);
  });
});

describe("fuzzyFileMatch", () => {
  const files = [
    "docs/architecture/01-overview.md",
    "src/app-shell/",
    "src/app-shell/App.tsx",
    "src/kernel/ipc.ts",
    "package.json",
  ];

  it("空 needle 返回字典序前缀(目录树稳定序)", () => {
    expect(fuzzyFileMatch(files, "", 3)).toEqual(files.slice(0, 3));
  });

  it("深层文件按文件名可模糊命中(重构核心诉求)", () => {
    const hits = fuzzyFileMatch(files, "ipc");
    expect(hits).toContain("src/kernel/ipc.ts");
    expect(hits[0]).toBe("src/kernel/ipc.ts");
  });

  it("目录候选(尾 /)同样可命中", () => {
    expect(fuzzyFileMatch(files, "app-shell/")).toContain("src/app-shell/");
  });

  it("limit 截断", () => {
    expect(fuzzyFileMatch(files, "", 2)).toHaveLength(2);
  });
});

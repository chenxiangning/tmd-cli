/**
 * parseRemoteStatus 契约测试:`git status --porcelain=v1 -b` 输出解析
 * (branch/ahead/behind/脏文件;空输出与非仓库形态)。
 */
import { describe, expect, it } from "vitest";
import { parseRemoteStatus } from "./useRemoteGitStatus";

describe("parseRemoteStatus", () => {
  it("常规:branch + upstream + ahead/behind + 文件行", () => {
    const out = [
      "## main...origin/main [ahead 1, behind 2]",
      " M src/a.ts",
      "A  new.txt",
      "?? notes.md",
      "R  old.ts -> new.ts",
    ].join("\n");
    const r = parseRemoteStatus(out)!;
    expect(r.branch).toBe("main");
    expect(r.upstream).toBe("origin/main");
    expect(r.ahead).toBe(1);
    expect(r.behind).toBe(2);
    expect(r.entries).toEqual([
      { xy: " M", path: "src/a.ts" },
      { xy: "A ", path: "new.txt" },
      { xy: "??", path: "notes.md" },
      { xy: "R ", path: "old.ts -> new.ts" },
    ]);
  });

  it("无 upstream 与 ahead/behind", () => {
    const r = parseRemoteStatus("## main\n M a")!;
    expect(r.branch).toBe("main");
    expect(r.upstream).toBeNull();
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(0);
  });

  it("无仓库输出 = null;干净工作区 = 空列表", () => {
    expect(parseRemoteStatus("fatal: not a git repository")).toBeNull();
    const clean = parseRemoteStatus("## main...origin/main")!;
    expect(clean.entries).toEqual([]);
  });
});

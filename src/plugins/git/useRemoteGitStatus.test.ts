/**
 * parseRemoteStatus 契约测试:`git status --porcelain=v1 -b` 输出解析
 * (branch/ahead/behind/脏文件;空输出与非仓库形态;quotepath/噪音行/
 * No commits yet/fatal 误诊 —— 0.4.6 复审 P1)。
 */
import { describe, expect, it } from "vitest";
import { isRemoteGitExecError, parseRemoteStatus } from "./useRemoteGitStatus";

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

  it("中文文件名原样保留(quotepath=false);整行外层引号剥掉,分侧引号如实", () => {
    const r = parseRemoteStatus('## main\n M src/文件.md\nM  "a\\"b.md"\nR  "旧 名.ts" -> 新名.ts')!;
    expect(r.entries).toEqual([
      { xy: " M", path: "src/文件.md" },
      { xy: "M ", path: "a\\\"b.md" },
      { xy: "R ", path: '"旧 名.ts" -> 新名.ts' },
    ]);
  });

  it("空仓 No commits yet:分支名如实,不再解析出「No」", () => {
    const r = parseRemoteStatus("## No commits yet on main\n?? a.txt")!;
    expect(r.branch).toBe("main");
    expect(r.upstream).toBeNull();
    expect(r.entries).toEqual([{ xy: "??", path: "a.txt" }]);
  });

  it("HEAD 分离形态:branch 显示原文", () => {
    const r = parseRemoteStatus("## HEAD (no branch)")!;
    expect(r.branch).toBe("HEAD (no branch)");
  });

  it("噪音行丢弃:stderr/warning 不合成假脏文件条目", () => {
    const r = parseRemoteStatus([
      "## main...origin/main",
      "warning: LF will be replaced by CRLF",
      " M a.ts",
      "some free-form stderr noise",
    ].join("\n"))!;
    expect(r.entries).toEqual([{ xy: " M", path: "a.ts" }]);
  });

  it("fatal/命令缺失误诊判定:含执行错误痕迹 = 远端执行错误,非「不是仓库」", () => {
    expect(isRemoteGitExecError("fatal: not a git repository (or any of the parent directories)")).toBe(true);
    expect(isRemoteGitExecError("/bin/bash: git: command not found")).toBe(true);
    expect(isRemoteGitExecError("## main\n M a")).toBe(false);
    expect(isRemoteGitExecError("")).toBe(false);
  });
});

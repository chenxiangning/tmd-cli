/**
 * 打开方式清单清洗契约测试 —— settingsSanitizeOpenWith:
 * 非数组回落默认种子、坏条目逐类剔除(kind 白名单/空 label/缺配套字段)、
 * args 收窄、finder 归一、超限截断、保序。
 */

import { describe, expect, it } from "vitest";
import { sanitizeOpenWithTargets } from "./settingsSanitizeOpenWith";

describe("sanitizeOpenWithTargets", () => {
  it("非数组回落默认种子(访达)", () => {
    expect(sanitizeOpenWithTargets(undefined)).toEqual([
      { id: "finder", label: "访达", kind: "finder" },
    ]);
    expect(sanitizeOpenWithTargets("nope" as unknown)).toEqual([
      { id: "finder", label: "访达", kind: "finder" },
    ]);
  });

  it("空数组保留为空(消费侧据此隐藏入口)", () => {
    expect(sanitizeOpenWithTargets([])).toEqual([]);
  });

  it("非对象条目与空 id/label 剔除", () => {
    expect(
      sanitizeOpenWithTargets([null, 42, { id: "", label: "x", kind: "finder" }, { id: "a", label: "  ", kind: "finder" }]),
    ).toEqual([]);
  });

  it("非法 kind 剔除(open -a 之外的启动语义不认识)", () => {
    expect(sanitizeOpenWithTargets([{ id: "a", label: "A", kind: "shell" }])).toEqual([]);
  });

  it("app 缺 appName / command 缺 command 剔除", () => {
    expect(sanitizeOpenWithTargets([{ id: "a", label: "A", kind: "app" }])).toEqual([]);
    expect(sanitizeOpenWithTargets([{ id: "b", label: "B", kind: "command" }])).toEqual([]);
  });

  it("合法 app/command 条目保留,args 收窄为非空字符串", () => {
    expect(
      sanitizeOpenWithTargets([
        { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code", args: ["-n", 1, "", "  "] },
        { id: "wt", label: "WT", kind: "command", command: "wt.exe", args: ["-p"] },
      ]),
    ).toEqual([
      { id: "vscode", label: "VS Code", kind: "app", appName: "Visual Studio Code", args: ["-n"] },
      { id: "wt", label: "WT", kind: "command", command: "wt.exe", args: ["-p"] },
    ]);
  });

  it("finder 归一:丢弃误带的 appName/command/args", () => {
    expect(
      sanitizeOpenWithTargets([{ id: "finder", label: "访达", kind: "finder", appName: "/x", args: ["-y"] }]),
    ).toEqual([{ id: "finder", label: "访达", kind: "finder" }]);
  });

  it("超限截断 32 条,保序", () => {
    const raw = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, label: `L${i}`, kind: "finder" }));
    const out = sanitizeOpenWithTargets(raw);
    expect(out).toHaveLength(32);
    expect(out[0].id).toBe("c0");
    expect(out[31].id).toBe("c31");
  });
});

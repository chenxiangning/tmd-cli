/** 存储管家纯函数边界(格式化/类目清单/已归档过滤)。 */

import { describe, expect, it } from "vitest";
import { auditCategories, reportByKey } from "./auditCategories";
import { archivedEntries } from "./docgenArchive";
import { formatBytes } from "./format";
import type { DocGenEntry } from "@plugins/workbench/docgen/types";

describe("formatBytes", () => {
  it("B 段不进位,1024 起逐级换算,一位小数", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });

  it("超大值封顶 TB 不再升级", () => {
    const tb = 1024 ** 4;
    expect(formatBytes(tb)).toBe("1.0 TB");
    expect(formatBytes(tb * 2048)).toBe("2048.0 TB");
  });
});

describe("auditCategories", () => {
  const cats = auditCategories("/home/u", "/home/u/.tmd-cli");

  it("十三类目全在,键唯一", () => {
    expect(cats.map((c) => c.key)).toEqual([
      "checkpoints", "session-logs", "docgen", "omp", "pi", "claude", "qoder", "codex", "kimi", "kimi-legacy",
      "qoder-cn", "grok", "dsh",
    ]);
    expect(new Set(cats.map((c) => c.key)).size).toBe(cats.length);
  });

  it("路径由注入的 home/configDir 拼装;skip 全空(objects.git 必须计入)", () => {
    const byKey: Record<string, string> = {};
    for (const c of cats) byKey[c.key] = c.path;
    expect(byKey.checkpoints).toBe("/home/u/.tmd-cli/checkpoints");
    expect(byKey.docgen).toBe("/home/u/.tmd-cli/workbench/docgen");
    expect(byKey.omp).toBe("/home/u/.omp/agent/sessions");
    expect(byKey.pi).toBe("/home/u/.pi/agent/sessions");
    expect(byKey.claude).toBe("/home/u/.claude/projects");
    expect(byKey.qoder).toBe("/home/u/.qoder/projects");
    expect(byKey.codex).toBe("/home/u/.codex/sessions");
    expect(byKey.kimi).toBe("/home/u/.kimi-code/sessions");
    expect(byKey.grok).toBe("/home/u/.grok/sessions");
    expect(cats.every((c) => c.skipDirNames.length === 0)).toBe(true);
  });
});

describe("reportByKey", () => {
  it("按 label 分组;同 label 后到覆盖", () => {
    const grouped = reportByKey([
      { label: "omp", bytes: 10, files: 2, timedOut: false },
      { label: "pi", bytes: 0, files: 0, timedOut: true },
      { label: "omp", bytes: 99, files: 9, timedOut: false },
    ]);
    expect(grouped.omp).toEqual({ bytes: 99, files: 9, timedOut: false });
    expect(grouped.pi).toEqual({ bytes: 0, files: 0, timedOut: true });
  });
});

describe("archivedEntries", () => {
  const base = {
    templateId: "t",
    title: "文档",
    scope: { kind: "all" as const },
    periodKey: "2026-W41",
    periodLabel: "2026-W41",
    periodFrom: "2026-10-05",
    periodTo: "2026-10-11",
    audience: "",
    engine: "omp",
    sources: "git" as never,
    status: "done" as const,
    versions: [],
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
  };
  const entry = (id: string, docState: DocGenEntry["docState"]): DocGenEntry =>
    ({ ...base, id, docState }) as DocGenEntry;

  it("只留 docState === archived", () => {
    const rows = archivedEntries([
      entry("a", "draft"),
      entry("b", "archived"),
      entry("c", "reported"),
      entry("d", "archived"),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["b", "d"]);
  });
});

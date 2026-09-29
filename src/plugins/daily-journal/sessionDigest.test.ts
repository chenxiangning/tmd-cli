/** 摘录层测试(块压缩/预算截断/报错升格/末条结论保底/全日装配)。 */
import { describe, expect, it, vi } from "vitest";
import { buildDayDigest, capLine, renderSessionDigest, DAY_CHAR_CAP, type DigestCaps } from "./sessionDigest";
import type { DaySessionRow } from "./daySessions";
import type { CliDiskSession, CliTranscriptBlock, CliTranscriptToolMeta } from "@kernel/cli";

const h = vi.hoisted(() => ({ profiles: [] as { id: string; readSessionTranscript?: (d: CliDiskSession) => Promise<{ blocks: CliTranscriptBlock[] } | null> }[] }));
vi.mock("@kernel/host", () => ({ host: { getCliProfiles: () => h.profiles } }));

const row: DaySessionRow = {
  profileId: "omp",
  title: "修复工作区选择器",
  startedAt: new Date("2026-09-29T15:48:00").getTime(),
  modifiedAt: new Date("2026-09-29T16:00:00").getTime(),
  live: false,
  wsName: "tmd-cli",
};

const block = (role: CliTranscriptBlock["role"], text: string, tool?: CliTranscriptToolMeta): CliTranscriptBlock => ({
  id: Math.random().toString(36).slice(2),
  role,
  text,
  ...(tool ? { tool } : {}),
});

const caps: DigestCaps = { user: 50, assistant: 40, tool: 30, session: 120 };

describe("capLine", () => {
  it("空白折叠单行化 + 保头截断标记", () => {
    expect(capLine("a\n\nb\t c", 20)).toBe("a b c");
    expect(capLine("x".repeat(60), 10)).toBe(`${"x".repeat(10)}…(截断)`);
  });
});

describe("renderSessionDigest", () => {
  it("user/assistant 保留、reasoning/system 丢弃、tool 压单行", () => {
    const md = renderSessionDigest(row, [
      block("system", "context injected"),
      block("user", "工作区选择器点不开,报 TypeError"),
      block("reasoning", "let me think"),
      block("tool", "", { title: "编辑 src/workspace.ts", status: "success" }),
      block("assistant", "定位到 isExpanded 未初始化,已修复"),
    ], caps)!;
    expect(md).toMatch(/^### 15:48 \[omp\] 修复工作区选择器\(tmd-cli\)\n/);
    expect(md).toContain("用户:工作区选择器点不开,报 TypeError");
    expect(md).toContain("动作:编辑 src/workspace.ts");
    expect(md).toContain("助手:定位到 isExpanded 未初始化");
    expect(md).not.toContain("let me think");
    expect(md).not.toContain("context injected");
  });

  it("工具报错升格「报错」行并附 detail(error/failed 两词表)", () => {
    const md = renderSessionDigest(row, [
      block("tool", "", { title: "pnpm test", status: "error", detail: "FAIL src/x.test.ts 3 failed" }),
      block("tool", "", { title: "opencode run", status: "failed", detail: "exit 1" }),
    ], caps)!;
    expect(md).toContain("报错:pnpm test — FAIL src/x.test.ts");
    expect(md).toContain("报错:opencode run — exit 1");
    expect(md).not.toContain("动作:");
  });

  it("超会话预算:截断标注 + 末条助手结论保底(不与已收行重复)", () => {
    const longTail = "最终结论:根因是 liveKey 未纳入刷新 tick,修复并补了回归测试。".repeat(6);
    const md = renderSessionDigest(row, [
      block("user", "选择器点不开"),
      block("assistant", longTail),
      block("user", "还是不行,控制台报 undefined"),
      block("user", "再看一下 diff,第 3 行少了个分号"),
      block("assistant", "补了 tick 订阅,这次验证通过,结论:liveKey 缺 refreshTick。"),
    ], caps)!;
    expect(md).toContain("(摘录超预算,后续内容省略)");
    expect(md).toContain("助手(结尾):补了 tick 订阅");
    expect(md).toContain("用户:还是不行");
  });

  it("真末条结论在预算切断点之后仍被保底(全量预扫,不依赖循环到达)", () => {
    const filler = block("user", `超长上下文占位 ${"x".repeat(45)}`);
    const md = renderSessionDigest(row, [
      filler,
      { ...filler, id: "f2" },
      { ...filler, id: "f3" },
      block("assistant", "收尾:问题收敛于默认工作区未持久化,已修复。"),
    ], caps)!;
    expect(md).toContain("(摘录超预算,后续内容省略)");
    expect(md).toContain("助手(结尾):收尾:问题收敛于默认工作区未持久化");
  });

  it("无内容块返回 null(按仅标题处理)", () => {
    expect(renderSessionDigest(row, [block("reasoning", "hmm")], caps)).toBeNull();
    expect(renderSessionDigest(row, [], caps)).toBeNull();
  });
});

const diskOf = (id: string): CliDiskSession => ({ id, path: `/tmp/${id}.jsonl`, modifiedAt: 1 }) as CliDiskSession;
const drow = (id: string): DaySessionRow => ({
  profileId: "omp",
  id,
  title: `会话 ${id}`,
  startedAt: new Date("2026-09-29T10:00:00").getTime(),
  modifiedAt: 2,
  live: false,
  wsName: "w",
  disk: diskOf(id),
});

describe("buildDayDigest 装配", () => {
  it("首条用户消息含生成任务标记的会话被剔除(自指防混入)", async () => {
    h.profiles = [
      {
        id: "omp",
        readSessionTranscript: async (d) =>
          d.id === "gen-1"
            ? { blocks: [block("user", "# 每日工作日志生成任务:2026-09-29\n把今天整理成文章"), block("assistant", "已写入")] }
            : { blocks: [block("user", "正常会话的内容"), block("assistant", "正常结论")] },
      },
    ];
    const d = await buildDayDigest([drow("gen-1"), drow("normal")].map((r, i) => (i === 0 ? r : { ...r, disk: diskOf("normal") })));
    expect(d.md).not.toContain("gen-1");
    expect(d.coveredIds).toEqual(["normal"]);
    h.profiles = [];
  });

  it("全日预算超出:省略注记在位,coveredIds 只含实收", async () => {
    h.profiles = [
      {
        id: "omp",
        readSessionTranscript: async (d) => ({
          blocks: [block("user", `内容 ${d.id} ${"y".repeat(380)}`)],
        }),
      },
    ];
    const rows = Array.from({ length: Math.ceil((DAY_CHAR_CAP + 10_000) / 430) + 2 }, (_, i) => drow(`s${i}`));
    const d = await buildDayDigest(rows);
    expect(d.md).toContain("(超出全日预算,部分会话摘录省略)");
    expect(d.coveredIds.length).toBeLessThan(rows.length);
    expect(d.covered).toBe(d.coveredIds.length);
    h.profiles = [];
  });
});

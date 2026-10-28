/**
 * targets + evidence + corpus 纯函数单测 —— 目标去重/探活降级、IDF 门槛与
 * 三通道证据、语料净化(civil 注入过滤)与块转换。
 */
import { describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ fsReadHeads: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));

import { expandLintTargets, probeTargets } from "./targets";
import { CORRECTIONS, discriminativeTokens, enforceVerdictContract, measureEvidence, normalizeCmd, scriptVerdict } from "./evidence";
import { blocksToCorpus, sanitizeUserText } from "./corpus";
import type { CorpusMsg, RuleItem, SessionCorpus } from "./lintTypes";

describe("expandLintTargets", () => {
  it("同文件多引擎去重合并 engines;project 拼 cwd / user 拼 home;无 cwd 项目级不出", () => {
    const profiles = [
      { id: "pi", memoryFiles: [{ scope: "project" as const, label: "AGENTS.md", relPath: "AGENTS.md" }] },
      { id: "codex", memoryFiles: [
        { scope: "project" as const, label: "AGENTS.md", relPath: "AGENTS.md" },
        { scope: "user" as const, label: "AGENTS.md", relPath: ".codex/AGENTS.md" },
      ] },
    ];
    expect(expandLintTargets(profiles, "/ws/demo", "/home/u").map((t) => [t.absPath, t.engines])).toEqual([
      ["/ws/demo/AGENTS.md", ["pi", "codex"]],
      ["/home/u/.codex/AGENTS.md", ["codex"]],
    ]);
    expect(expandLintTargets(profiles, null, "/home/u").map((t) => t.absPath)).toEqual([
      "/home/u/.codex/AGENTS.md",
    ]);
  });
});

describe("probeTargets", () => {
  it("fsReadHeads 按下标对齐;空串 = 缺", async () => {
    ipcMock.fsReadHeads.mockResolvedValue(["#", ""]);
    expect(await probeTargets(["/a", "/b"])).toEqual({ "/a": true, "/b": false });
  });
});

function ruleOf(text: string, tokens: string[], kind: RuleItem["kind"] = "other"): RuleItem {
  return { idx: 1, file: "/ws/AGENTS.md", line: 1, lineEnd: 1, text, section: "(无章节)", kind, tokens, pathRefs: [], estTokens: 10 };
}

function msg(text: string, role: "user" | "assistant" = "assistant", sessionIdx = 0): CorpusMsg {
  return { sessionIdx, role, text, lower: text.toLowerCase(), ts: 1_700_000_000_000 };
}

function emptyCorpus(): SessionCorpus {
  return { msgs: [], calls: [], sessionCwds: [], sessionCount: 0, readFiles: 0, perProfile: [] };
}

describe("discriminativeTokens", () => {
  it("IDF 门槛:超高频词被剔除,低频词保留;全超频 = unjudgeable", () => {
    const msgs = [
      ...Array.from({ length: 18 }, () => msg("src src src src src src")),
      ...Array.from({ length: 2 }, () => msg("rustdoc 独有词")),
    ];
    const rules = [ruleOf("a rustdoc b", ["src", "rustdoc"]), ruleOf("只有 src", ["src"])];
    const { byRule, unjudgeable } = discriminativeTokens(rules, msgs);
    expect(byRule[0]).toEqual(["rustdoc"]); /* df=2 ≤ 门槛 max(5, 20/2000=5) 保留;src df=18 剔除 */
    expect(unjudgeable[0]).toBe(false);
    expect(unjudgeable[1]).toBe(true); /* src 全超频 → 有信号词但全不可用 */
  });

  it("零信号词规则(纯中文提不出 tokens)也判 unjudgeable,不得落 dormant 预判", () => {
    const { unjudgeable } = discriminativeTokens([ruleOf("核心宗旨:追求艺术级的系统构建。", [])], [msg("随便聊聊")]);
    expect(unjudgeable[0]).toBe(true);
    expect(scriptVerdict(measureEvidence(ruleOf("核心宗旨:追求艺术级的系统构建。", []), [], true, emptyCorpus()), true)).toBe("unverifiable");
  });
});

describe("enforceVerdictContract", () => {
  const ev = (hits: number, unjudgeable: boolean) =>
    ({ ...measureEvidence(ruleOf("t", []), [], false, emptyCorpus()), hits, unjudgeable });
  it("dormant 越权回落:有触达=touched,词面不可用=unverifiable;合规 dormant 放行", () => {
    expect(enforceVerdictContract("dormant", ev(3, false))).toBe("touched");
    expect(enforceVerdictContract("dormant", ev(0, true))).toBe("unverifiable");
    expect(enforceVerdictContract("dormant", ev(0, false))).toBe("dormant");
    expect(enforceVerdictContract("working", ev(0, true))).toBe("working"); /* 非 dormant 不拦 */
  });
});

describe("measureEvidence", () => {
  it("触达/活跃会话/纠正/照做(命令归一包含)四通道", () => {
    const corpus: SessionCorpus = {
      msgs: [
        msg("记得跑 pnpm check:gate 再交付", "user", 0),
        msg("好的,我会跑 pnpm run check:gate", "assistant", 1),
        msg("这是别的话题", "assistant", 1),
      ],
      calls: [
        { sessionIdx: 0, detail: "pnpm run check:gate && vitest", ts: 2 },
        { sessionIdx: 1, detail: "ls -la", ts: 2 },
      ],
      sessionCwds: [null, null], sessionCount: 2, readFiles: 2, perProfile: [],
    };
    const ev = measureEvidence(ruleOf("交付前必须跑 pnpm check:gate", ["check:gate"], "command"), ["check:gate"], false, corpus);
    expect(ev.hits).toBe(2);
    expect(ev.activeSessions).toBe(2);
    expect(ev.corrections).toBe(0);
    expect(ev.complied).toBe(1); /* run 折叠后 pnpm run check:gate 命中 */
    expect(ev.complyQuote).toContain("check:gate");
  });

  it("纠正通道:user 同时命中信号词与纠正词表才计", () => {
    const corpus: SessionCorpus = {
      msgs: [msg("不对,提交信息要用中文祈使句,跟你说了几次了", "user", 0), msg("用中文祈使句比较好", "assistant", 0)],
      calls: [],
      sessionCwds: [null], sessionCount: 1, readFiles: 1, perProfile: [],
    };
    const ev = measureEvidence(ruleOf("提交信息用中文祈使句", ["中文祈使句"], "style"), ["中文祈使句"], false, corpus);
    expect(ev.corrections).toBe(1);
    expect(ev.correctionWords).toContain("不对");
    expect(ev.correctionQuotes[0]).toContain("跟你说了");
    expect(CORRECTIONS).not.toContain("不要"); /* 高频指令词刻意不入纠正词表 */
  });
});

describe("normalizeCmd", () => {
  it("run 折叠使 pnpm run x ≡ pnpm x", () => {
    expect(normalizeCmd("pnpm run check:gate")).toBe(normalizeCmd("pnpm check:gate"));
  });
});

describe("sanitizeUserText / blocksToCorpus", () => {
  it("系统注入(任务书/instructions)与超长丢弃", () => {
    expect(sanitizeUserText("<system-reminder>注入</system-reminder>")).toBeNull();
    expect(sanitizeUserText("Complete assignment thoroughly: do X")).toBeNull();
    expect(sanitizeUserText("见 <user_instructions> 注入")).toBeNull();
    expect(sanitizeUserText("x".repeat(4001))).toBeNull();
    expect(sanitizeUserText("  正常一句话 ")).toBe("正常一句话");
  });

  it("块转换:user/assistant 入 msgs,tool 取 detail,system/reasoning 不入,时间窗先扣", () => {
    const now = 1_700_000_100_000;
    const { msgs, calls } = blocksToCorpus(
      [
        { id: "1", role: "user", text: "窗口内", startedAt: now },
        { id: "2", role: "assistant", text: "窗口外", startedAt: 1_000 },
        { id: "3", role: "tool", text: "", startedAt: now, tool: { detail: "pnpm build" } },
        { id: "4", role: "reasoning", text: "思考", startedAt: now },
        { id: "5", role: "system", text: "系统", startedAt: now },
      ],
      3,
      now - 1000,
    );
    expect(msgs.map((m) => [m.sessionIdx, m.text])).toEqual([[3, "窗口内"]]);
    expect(calls).toEqual([{ sessionIdx: 3, detail: "pnpm build", ts: now }]);
  });
});

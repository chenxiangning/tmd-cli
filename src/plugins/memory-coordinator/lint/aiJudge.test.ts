/**
 * aiJudge / lintModel / applyLint 单测 —— 指令组装与回复解析(哨兵 JSON/围栏/
 * 坏对象捞回/越值剔除)、批切与汇总、删行守卫与归档占位(纯函数面,ipc 桩)。
 */
import { describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ fsReadFile: vi.fn(), fsWriteFile: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
vi.mock("@kernel/host", () => ({ host: { getCliProfiles: () => [], getCliProfile: () => null } }));
vi.mock("@kernel/sessionArchive", () => ({ archiveSession: vi.fn(), sessionArchiveKey: vi.fn(() => "k") }));

import { buildJudgeInstruction, JUDGE_ENGINES, parseJudgeReply } from "./aiJudge";
import { buildRecognizeInstruction } from "./recognizePrompt";
import { batchRules, summarizeRows, BATCH_SIZE } from "./lintModel";
import { scriptVerdict } from "./evidence";
import { CLAUDE_STUB, removeRuleFromFile, resetBackupsForTest, stubEdit } from "./applyLint";
import type { RuleEvidence, RuleItem, LintRow } from "./lintTypes";

function ruleOf(idx: number, text = `- 规则${idx}必须跑 \`pnpm check:gate\``, line = idx + 1): RuleItem {
  return { idx, file: "/ws/AGENTS.md", line, lineEnd: line, text, section: "验证", kind: "command", tokens: ["check:gate"], pathRefs: [], estTokens: 12 };
}

function evOf(partial: Partial<RuleEvidence> = {}): RuleEvidence {
  return {
    hits: 3, activeSessions: 2, lastSeen: 1_700_000_000_000, touchQuote: "提到过",
    corrections: 0, correctionWords: [], correctionQuotes: [], complied: 1,
    complyQuote: "pnpm check:gate", discTokens: ["check:gate"], unjudgeable: false,
    command: "pnpm check:gate", ...partial,
  };
}

describe("buildRecognizeInstruction(整文件版)", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => `- rule line ${i + 1}`).join("\n");
  it("全文带真实行号,限定需判定行并保留输出契约", () => {
    const inst = buildRecognizeInstruction("项目级规则文件", mk(20), [3, 8]);
    expect(inst).toContain("本次需判定行:3, 8");
    expect(inst).toContain("<RECOG>");
    expect(inst).toContain("L3: - rule line 3");
    expect(inst).toContain("L20: - rule line 20");
    expect(inst).toContain("不要漏行");
  });
});

/* ── 判定指令组装 ── */
describe("buildJudgeInstruction", () => {
  it("只发规则+脚本测量摘要(计数+预判),不带对话原文;零会话附语料为空警示", () => {
    const ev = evOf({ correctionQuotes: ["跟你说了用中文"], complyQuote: "pnpm check:gate", touchQuote: "提到过" });
    const withData = buildJudgeInstruction([{ rule: ruleOf(1), evidence: ev }], true);
    expect(withData).toContain("<LINT>");
    expect(withData).toContain('"working"');
    expect(withData).toContain("[1]");
    expect(withData).toContain("脚本测量:触达 3 条消息");
    expect(withData).toContain("脚本预判:working");
    expect(withData).not.toContain("跟你说了用中文"); /* 原文不出本机 */
    expect(withData).not.toContain("纠正原话");
    expect(withData).toContain("纠正 0 次");
    expect(withData).not.toContain("(注意");
    const empty = buildJudgeInstruction([{ rule: ruleOf(1), evidence: evOf({ hits: 0, complied: 0 }) }], false);
    expect(empty).toContain("(注意:本次语料为空");
    expect(empty).toContain("脚本预判:unverifiable");
  });
});

describe("scriptVerdict", () => {
  it("照做>0=working;纠正>0=violated;空语料/不可判=unverifiable;零触达=dormant;其余=touched", () => {
    const base = evOf();
    expect(scriptVerdict(base, true)).toBe("working");
    expect(scriptVerdict(evOf({ complied: 0, corrections: 1 }), true)).toBe("violated");
    expect(scriptVerdict(evOf({ complied: 0 }), false)).toBe("unverifiable");
    expect(scriptVerdict(evOf({ complied: 0, unjudgeable: true }), true)).toBe("unverifiable");
    expect(scriptVerdict(evOf({ complied: 0, hits: 0 }), true)).toBe("dormant");
    expect(scriptVerdict(evOf({ complied: 0, corrections: 0 }), true)).toBe("touched");
  });
});

describe("parseJudgeReply", () => {
  it("哨兵内 JSON 数组正常解析;i/v 对位映射", () => {
    const raw = 'noise <LINT>[{"i":1,"v":"working","r":"跑过了","a":"keep"},{"i":2,"v":"violated","r":"纠正两次","a":"archive"}]</LINT> tail';
    const out = parseJudgeReply(raw, 2);
    expect(out[0]).toEqual({ verdict: "working", reason: "跑过了", advice: "keep" });
    expect(out[1]).toEqual({ verdict: "violated", reason: "纠正两次", advice: "archive" });
  });

  it("整段 JSON 坏 → 逐对象捞回;越值 v / 越界 i 剔除;缺项留 null", () => {
    const raw = '<LINT>```json\n[{"i":1,"v":"dormant","r":"零触达","a":"remove"},坏了,{"i":9,"v":"working","r":"越界","a":"keep"},{"i":2,"v":"瞎说的","r":"x","a":"keep"}]\n```</LINT>';
    const out = parseJudgeReply(raw, 3);
    expect(out[0]).toEqual({ verdict: "dormant", reason: "零触达", advice: "remove" });
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
  });
});

describe("lintModel 批切与汇总", () => {
  it("batchRules 同文件连续切批,批大小 = BATCH_SIZE", () => {
    const rules = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => ruleOf(i + 1));
    const batches = batchRules(rules);
    expect(batches.map((b) => b.length)).toEqual([BATCH_SIZE, 3]);
  });

  it("summarizeRows:settled 优先、判定缺失入 failed、各态计数", () => {
    const rows: LintRow[] = [
      { rule: ruleOf(1), evidence: evOf(), judgment: { verdict: "violated", reason: "", advice: "archive" }, settled: true, scope: "project" },
      { rule: ruleOf(2), evidence: evOf(), judgment: { verdict: "violated", reason: "", advice: "keep" }, settled: false, scope: "project" },
      { rule: ruleOf(3), evidence: evOf(), judgment: null, settled: false, scope: "project" },
    ];
    const s = summarizeRows(rows);
    expect(s.verdicts.violated).toBe(1);
    expect(s.settled).toBe(1);
    expect(s.failed).toBe(1);
  });
});

describe("applyLint 删行守卫", () => {
  it("块原文与体检时不一致 → 拒绝落笔返 null;一致 → 删行/归档占位", () => {
    resetBackupsForTest();
    const rule = ruleOf(1, "- 甲规则:必须跑 pnpm build", 3);
    const text = ["# 头", "", "- 甲规则:必须跑 pnpm build", "", "- 乙规则"].join("\n");
    expect(removeRuleFromFile(text, rule, false)).toBe("# 头\n\n\n- 乙规则");
    expect(removeRuleFromFile(text, rule, true)).toContain("(原规则已迁至 docs/agents-archive.md)");
    const changed = text.replace("pnpm build", "pnpm test");
    expect(removeRuleFromFile(changed, rule, false)).toBeNull();
  });

  it("stub 声明与 stubEdit 产出整文件替换", () => {
    expect(CLAUDE_STUB).toContain("AGENTS.md");
    const edit = stubEdit({ id: "drift|x", kind: "drift", file: "/ws/CLAUDE.md", text: "", advice: "stub" });
    expect(edit).toEqual({ path: "/ws/CLAUDE.md", newText: CLAUDE_STUB });
  });

  it("引擎 argv 表:每家命令与 print 形态与 prompt-enhancer 实证表一致", () => {
    const ids = JUDGE_ENGINES.map((e) => e.id);
    expect(ids).toEqual(["claude", "codex", "omp", "pi", "opencode", "kimi", "qoder", "grok"]);
    expect(JUDGE_ENGINES.find((e) => e.id === "codex")!.buildArgs("P", null)).toEqual(["exec", "--skip-git-repo-check", "P"]);
    expect(JUDGE_ENGINES.find((e) => e.id === "claude")!.buildArgs("P", "m1")).toEqual(["-p", "P", "--model", "m1"]);
    expect(JUDGE_ENGINES.find((e) => e.id === "grok")!.buildArgs("P", null)).toEqual(["--single", "P"]);
  });
});

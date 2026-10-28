/**
 * aiJudge / lintModel / applyLint 单测 —— 指令组装与回复解析(哨兵 JSON/围栏/
 * 坏对象捞回/越值剔除)、批切与汇总、删行守卫与归档占位(纯函数面,ipc 桩)。
 */
import { describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({ fsReadFile: vi.fn(), fsWriteFile: vi.fn() }));
vi.mock("@kernel/ipc", () => ({ ipc: ipcMock }));
vi.mock("@kernel/host", () => ({ host: { getCliProfiles: () => [], getCliProfile: () => null } }));
vi.mock("@kernel/sessionArchive", () => ({ archiveSession: vi.fn(), sessionArchiveKey: vi.fn(() => "k") }));

import { JUDGE_ENGINES } from "./aiJudge";
import { buildUnifiedInstruction, parseUnifiedReply } from "./unifiedCall";
import { batchRules, summarizeRows, BATCH_SIZE } from "./lintModel";
import { scriptVerdict } from "./evidence";
import { CLAUDE_STUB, removeRuleFromFile, replaceRuleFromFile, resetBackupsForTest, stubEdit } from "./applyLint";
import { extractRules } from "./rulesExtract";
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

describe("buildUnifiedInstruction/parseUnifiedReply(单次调用)", () => {
  const ruleOf = (n: number): RuleItem => ({ file: "AGENTS.md", line: n, lineEnd: n, text: `- rule ${n}`, kind: "other", section: "", idx: n, tokens: [], pathRefs: [], estTokens: 10 });
  const evOf = (hits = 0): RuleEvidence => ({
    hits, activeSessions: 1, lastSeen: 1, touchQuote: "", corrections: 0, correctionWords: [],
    correctionQuotes: [], complied: 0, complyQuote: "", discTokens: [], unjudgeable: false, command: "",
  });
  it("指令带序号+脚本测量+压缩口径", () => {
    const inst = buildUnifiedInstruction([{ rule: ruleOf(3), evidence: evOf(5) }], true);
    expect(inst).toContain("0|- rule 3|触达5/会话1/纠正0/照做0");
    expect(inst).toContain("<JUDGE>");
    expect(inst).toContain("≤20字");
  });
  it("解析逐对象捞,坏项跳过;越界/空语料处理", () => {
    expect(buildUnifiedInstruction([{ rule: ruleOf(1), evidence: evOf() }], false)).toContain("语料为空");
    const raw = '<JUDGE>```json\n[{"i":0,"ok":false,"v":"touched","why":"无判据","fix":"- 明确可执行写法"},{"i":1,"ok":true,"v":"working","why":"命令明确"},{"i":9,"ok":true,"v":"dormant","why":"越界"}]\n```</JUDGE>';
    expect(parseUnifiedReply(raw, 1)).toHaveLength(2);
    const items = parseUnifiedReply(raw);
    expect(items[0]).toMatchObject({ i: 0, ok: false, v: "touched" });
    expect(items[0]?.fix).toBe("- 明确可执行写法");
    expect(items[1]?.fix).toBeUndefined();
  });
  it("unjudgeable 行带「词面不可用」标记;指令含判定铁律", () => {
    const inst = buildUnifiedInstruction([{ rule: ruleOf(2), evidence: { ...evOf(0), unjudgeable: true } }], true);
    expect(inst).toContain("触达0/会话1/纠正0/照做0/词面不可用");
    expect(inst).toContain("判定铁律");
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
    const text = ["# 头", "", "- 甲规则:必须跑 pnpm build", "", "- 乙规则"].join("\n");
    const rule = extractRules(text, "/ws/AGENTS.md")[0]!;
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

  it("行号漂移自愈:行号失配但文本在 → 锚定命中仍可改/删;多命中取最近;文本消失才 null", () => {
    const rule = extractRules("# 头\n\n- 甲规则:必须跑 pnpm build", "/ws/AGENTS.md")[0]!;
    const drifted = ["# 头", "- 甲规则:必须跑 pnpm build", "", "- 乙规则"].join("\n"); /* 原文上移一行,行号 3 已失效 */
    expect(replaceRuleFromFile(drifted, rule, "- 甲规则:已改写")).toBe("# 头\n- 甲规则:已改写\n\n- 乙规则");
    expect(removeRuleFromFile(drifted, rule, false)).toBe("# 头\n\n- 乙规则");
    const twin = ["# 头", "- 甲规则:必须跑 pnpm build", "", "- 甲规则:必须跑 pnpm build"].join("\n"); /* 行 2/4 双命中 */
    expect(replaceRuleFromFile(twin, rule, "- 已改写")).toBe("# 头\n- 已改写\n\n- 甲规则:必须跑 pnpm build");
    const gone = "# 头\n- 乙规则";
    expect(replaceRuleFromFile(gone, rule, "- x")).toBeNull();
    expect(removeRuleFromFile(gone, rule, false)).toBeNull();
  });

  it("真实提取会剥列表标记:有序/无序规则仍能锚定改写与删除", () => {
    const text = ["# 规则", "1. 有序规则:必须执行", "- 无序规则:必须执行"].join("\n");
    const [ordered, unordered] = extractRules(text, "/ws/AGENTS.md");
    expect(ordered!.text).toBe("有序规则:必须执行");
    expect(unordered!.text).toBe("无序规则:必须执行");
    expect(replaceRuleFromFile(text, ordered!, "1. 有序规则:已改写")).toBe("# 规则\n1. 有序规则:已改写\n- 无序规则:必须执行");
    expect(removeRuleFromFile(text, unordered!, false)).toBe("# 规则\n1. 有序规则:必须执行");
  });

  it("快照不二次剥标记:嵌套有序文本仍命中原规则而非相邻规则", () => {
    const text = ["- 1. 交付前必须跑测试", "- 交付前必须跑测试"].join("\n");
    const [nested] = extractRules(text, "/ws/AGENTS.md");
    expect(nested!.text).toBe("1. 交付前必须跑测试");
    expect(replaceRuleFromFile(text, nested!, "- 1. 交付前必须跑门禁")).toBe("- 1. 交付前必须跑门禁\n- 交付前必须跑测试");
  });

  it("原规则真删后不命中普通段落或围栏示例", () => {
    const [rule] = extractRules("- 不得直接提交", "/ws/AGENTS.md");
    const current = ["不得直接提交", "```md", "- 不得直接提交", "```"].join("\n");
    expect(replaceRuleFromFile(current, rule!, "- 已改写")).toBeNull();
    expect(removeRuleFromFile(current, rule!, false)).toBeNull();
  });

  it("引擎 argv 表:每家命令与 print 形态与 prompt-enhancer 实证表一致", () => {
    const ids = JUDGE_ENGINES.map((e) => e.id);
    expect(ids).toEqual(["claude", "codex", "omp", "pi", "opencode", "kimi", "qoder", "grok"]);
    expect(JUDGE_ENGINES.find((e) => e.id === "codex")!.buildArgs("P", null)).toEqual(["exec", "--skip-git-repo-check", "P"]);
    expect(JUDGE_ENGINES.find((e) => e.id === "claude")!.buildArgs("P", "m1")).toEqual(["-p", "P", "--model", "m1"]);
    expect(JUDGE_ENGINES.find((e) => e.id === "grok")!.buildArgs("P", null)).toEqual(["--single", "P"]);
  });
});

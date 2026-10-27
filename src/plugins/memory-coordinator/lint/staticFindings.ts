/**
 * 静态发现(确定性,不烧模型)—— 补齐独立版 tmd-lint 的三类非判定发现:
 * drift(CLAUDE.md 非 stub 与 AGENTS.md 并存)、stale(路径引用失效,唯一同名
 * 命中给 fixpath 修复建议)、missing(「你反复在说」:跨会话重复出现且未被
 * 规则文件覆盖的指令句,建议写进 AGENTS.md;移植 findings_missing.rs 口径:
 * ≥2 个不同会话且 ≥2 次、4 字 CJK 滑窗覆盖判断)。
 */

import { ipc } from "@kernel/ipc";
import { CORRECTIONS } from "./evidence";
import type { CorpusMsg, LintTarget, RuleItem, StaticFinding } from "./lintTypes";

/** 指令特征词(移植 INSTRUCTION_HINTS):含任一才作候选。 */
export const INSTRUCTION_HINTS = [
  "必须", "不要", "统一", "一律", "命名", "目录", "格式", "只能", "不许",
  "都用", "别用", "不用", "禁止", "要求",
];

const PATH_REF_SKIP = /:\/\/|@|<|>|\*/;
const FORBIDDEN_CONTEXT = /(禁止|不得|不允许|严禁|白名单|只允许)/;
const SKIP_DIRS = /^(node_modules|dist|build|target|\.next|\.venv|vendor|coverage)$/;

function isStubClaude(text: string): boolean {
  const nonEmpty = text.split("\n").filter((l) => l.trim() !== "");
  return nonEmpty.length <= 8 && nonEmpty.some((l) => l.includes("AGENTS.md"));
}

async function pathExists(path: string): Promise<boolean> {
  const asFile = await ipc.fsReadHead(path, 1).then(() => true, () => false);
  if (asFile) return true;
  return ipc.fsCollectFiles(path, "").then(() => true, () => false);
}

/** 覆盖判断:行内任一 4 字纯 CJK 滑窗或任一 ≥4 长 ascii 串出现在规则全文中。 */
export function coveredBy(line: string, ruleTextAll: string): boolean {
  const hay = ruleTextAll.toLowerCase();
  const cjk = /[\u4e00-\u9fff]/;
  for (let i = 0; i + 4 <= line.length; i++) {
    const w = line.slice(i, i + 4);
    if (cjk.test(w) && !/[a-z0-9]/i.test(w) && hay.includes(w)) return true;
  }
  for (const run of line.match(/[A-Za-z0-9_\-./:]{4,}/g) ?? []) {
    if (hay.includes(run.toLowerCase())) return true;
  }
  return false;
}

export interface RepeatedLine {
  key: string;
  text: string;
  count: number;
  sessions: number;
}

/** 「你反复在说」聚合:user 指令句(≥4 字 ≤120 字、含特征词、非纠正话术)
 *  归一化后 ≥2 会话且 ≥2 次、未被规则文件覆盖的,按次数降序取前 cap。 */
export function repeatedLines(msgs: CorpusMsg[], ruleTextAll: string, cap = 8): RepeatedLine[] {
  const agg = new Map<string, { text: string; count: number; sessions: Set<number> }>();
  for (const m of msgs) {
    if (m.role !== "user" || m.text.length < 4 || m.text.length > 120) continue;
    if (!INSTRUCTION_HINTS.some((h) => m.text.includes(h))) continue;
    if (CORRECTIONS.some((w) => m.lower.includes(w))) continue;
    const key = m.lower.replace(/\s+/g, " ").trim();
    const hit = agg.get(key) ?? { text: m.text, count: 0, sessions: new Set<number>() };
    hit.count += 1;
    hit.sessions.add(m.sessionIdx);
    agg.set(key, hit);
  }
  return [...agg.values()]
    .filter((h) => h.sessions.size >= 2 && h.count >= 2 && !coveredBy(h.text, ruleTextAll))
    .sort((a, b) => b.count - a.count)
    .slice(0, cap)
    .map((h) => ({ key: h.text.toLowerCase().replace(/\s+/g, " ").trim(), text: h.text, count: h.count, sessions: h.sessions.size }));
}

/** 同名文件搜索(fixpath 修复建议):walk 结果里唯一同名命中才给。 */
function uniqueSameBasename(ref: string, repoFiles: string[]): string | null {
  const base = ref.split("/").pop()!;
  const hits = repoFiles.filter((f) => f.split("/").pop() === base && !f.split("/").some((s) => SKIP_DIRS.test(s)));
  return hits.length === 1 ? hits[0]! : null;
}

export interface StaticOpts {
  cwd: string;
  rulesByFile: { target: LintTarget; rules: RuleItem[]; text: string }[];
  msgs: CorpusMsg[];
  /** 仓库相对路径清单(fixpath 同名搜索;空 = 跳过 fixpath 建议)。 */
  repoFiles?: string[];
}

export async function buildStaticFindings(opts: StaticOpts): Promise<StaticFinding[]> {
  const out: StaticFinding[] = [];
  const ruleTextAll = opts.rulesByFile.map((f) => f.text).join("\n").toLowerCase();
  for (const f of opts.rulesByFile) {
    const base = f.target.absPath.split("/").pop() ?? "";
    if (base === "CLAUDE.md" && !isStubClaude(f.text)) {
      out.push({
        id: `drift|${f.target.absPath}`, kind: "drift", file: f.target.absPath,
        text: "", extra: "CLAUDE.md", advice: "stub",
      });
    }
    for (const rule of f.rules) {
      if (FORBIDDEN_CONTEXT.test(rule.text)) continue; /* 禁令语境的路径是「不该存在」的提及 */
      for (const ref of rule.pathRefs) {
        if (ref.length > 160 || PATH_REF_SKIP.test(ref)) continue;
        if (await pathExists(`${opts.cwd}/${ref}`)) continue;
        const first = ref.split("/")[0]!;
        if (ref.startsWith(".") && !(await pathExists(`${opts.cwd}/${first}`))) continue; /* 指向 home 的用户目录 */
        const fix = opts.repoFiles ? uniqueSameBasename(ref, opts.repoFiles) : null;
        out.push({
          id: `stale|${rule.file}|${rule.line}|${ref}`, kind: "stale", file: rule.file,
          text: `${rule.text.split("\n")[0]}\n⤷ ${ref}`,
          extra: fix ? `${ref}=>${fix}` : undefined,
          advice: fix ? "fixpath" : "keep",
        });
        break; /* 一条规则报首个失效引用即可 */
      }
    }
  }
  for (const r of repeatedLines(opts.msgs, ruleTextAll)) {
    const target = opts.rulesByFile.find((f) => f.target.absPath.endsWith("/AGENTS.md")) ?? opts.rulesByFile[0];
    if (!target) break;
    out.push({
      id: `missing|${r.key}`, kind: "missing", file: target.target.absPath,
      text: r.text, extra: `${r.count} 次/${r.sessions} 会话`, advice: "write",
    });
  }
  return out;
}

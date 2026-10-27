/**
 * 行内动作编排 —— 建议(删除/归档/收口 stub/修路径/写进 AGENTS.md/上 hook/
 * AI 改写/备份恢复)到真实写盘的桥。全部走 applyLint 安全件:重读现文 →
 * 原文匹配守卫 → 先备份后写;**每次应用把保存之前与之后的内容记入应用日志**
 * (lintStore.applyJournal,报告页可回看可恢复);破坏性动作由调用方先过
 * 确认弹层(diff 预览),本模块不重复确认。
 */

import { ipc } from "@kernel/ipc";
import {
  appendArchive, applyEdits, applyHook, appendRuleLine, fixPathInFile,
  removeRuleFromFile, replaceRuleFromFile, restoreBackups, stubEdit,
} from "./applyLint";
import { addApplyRecords } from "./lintStore";
import type { ApplyRecord, LintAdvice, LintRow, StaticFinding } from "./lintTypes";

export interface ActionResult {
  ok: boolean;
  /** 展示给用户的失败原因(成功为空串)。 */
  note: string;
}

async function readText(path: string): Promise<string | null> {
  return ipc.fsReadFile(path).catch(() => null);
}

/** 落盘并记应用日志(before/after 都在)。 */
async function writeJournaled(kind: string, path: string, before: string, after: string): Promise<ActionResult> {
  const results = await applyEdits([{ path, newText: after }]);
  if (!results[0]?.ok) return { ok: false, note: "写盘失败" };
  await addApplyRecords([{ at: Date.now(), kind, path, before, after }]);
  return { ok: true, note: "" };
}

/** 按建议处理一条规则(remove/archive)。 */
export async function applyRuleAdvice(cwd: string, row: LintRow, advice: LintAdvice): Promise<ActionResult> {
  if (advice !== "remove" && advice !== "archive") return { ok: false, note: "" };
  try {
    const text = await readText(row.rule.file);
    if (text === null) return { ok: false, note: "规则文件读不到,请重新体检" };
    const next = removeRuleFromFile(text, row.rule, advice === "archive");
    if (next === null) return { ok: false, note: "文件已变化,行号对不上;请重新体检" };
    const r = await writeJournaled(advice === "remove" ? "删除规则" : "归档规则", row.rule.file, text, next);
    if (!r.ok) return r;
    if (advice === "archive") {
      const archived = await appendArchive(cwd, [row.rule.text.replace(/\n+/g, " ")]);
      if (!archived) return { ok: true, note: "已删行,但归档文件写入失败" };
    }
    return { ok: true, note: "" };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** AI 改写应用(单条):不可识别规则行替换为模型给的改写文本(守卫+日志)。 */
export async function applyRuleRewrite(row: LintRow): Promise<ActionResult> {
  const rewrite = row.aiMark?.rewrite;
  if (!rewrite) return { ok: false, note: "该条没有改写建议" };
  try {
    const text = await readText(row.rule.file);
    if (text === null) return { ok: false, note: "规则文件读不到,请重新体检" };
    const next = replaceRuleFromFile(text, row.rule, rewrite);
    if (next === null) return { ok: false, note: "文件已变化,行号对不上;请重新体检" };
    return writeJournaled("AI 改写", row.rule.file, text, next);
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** 一键应用 AI 结果:把当前结果里所有带改写建议的规则行批量替换
 *  (逐行守卫,任一行守卫失败跳过并计数;按文件聚合落盘+日志)。 */
export async function applyAllAiRewrites(rows: LintRow[]): Promise<ActionResult & { applied: number; skipped: number }> {
  const pending = rows.filter((r) => r.aiMark && !r.aiMark.recognizable && r.aiMark.rewrite && !r.settled);
  if (pending.length === 0) return { ok: true, note: "", applied: 0, skipped: 0 };
  const byFile = new Map<string, LintRow[]>();
  for (const r of pending) {
    byFile.set(r.rule.file, [...(byFile.get(r.rule.file) ?? []), r]);
  }
  const journal: ApplyRecord[] = [];
  let applied = 0;
  let skipped = 0;
  for (const [path, list] of byFile) {
    const before = await readText(path);
    if (before === null) {
      skipped += list.length;
      continue;
    }
    let next = before;
    for (const row of list) {
      const step = replaceRuleFromFile(next, row.rule, row.aiMark!.rewrite!);
      if (step === null) {
        skipped += 1;
        continue;
      }
      next = step;
      applied += 1;
    }
    if (next !== before) {
      const results = await applyEdits([{ path, newText: next }]);
      if (results[0]?.ok) journal.push({ at: Date.now(), kind: "AI 改写(一键)", path, before, after: next });
      else skipped += list.length;
    }
  }
  await addApplyRecords(journal);
  return { ok: applied > 0 || pending.length === skipped, note: "", applied, skipped };
}

/** drift 收口:CLAUDE.md 整文件替换为 stub 声明。 */
export async function applyFindingStub(finding: StaticFinding): Promise<ActionResult> {
  try {
    const before = await readText(finding.file);
    if (before === null) return { ok: false, note: "规则文件读不到,请重新体检" };
    return writeJournaled("收口 stub", finding.file, before, stubEdit(finding).newText);
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** stale+fixpath:行内旧路径替换为仓库唯一同名命中(extra = "old=>new")。 */
export async function applyFindingFixpath(finding: StaticFinding): Promise<ActionResult> {
  const [oldP, newP] = (finding.extra ?? "").split("=>");
  if (!oldP || !newP) return { ok: false, note: "修复建议缺少路径对,请重新体检" };
  try {
    const text = await readText(finding.file);
    if (text === null) return { ok: false, note: "规则文件读不到,请重新体检" };
    const lineNo = Number.parseInt(finding.id.split("|")[2] ?? "", 10);
    if (!Number.isInteger(lineNo)) return { ok: false, note: "行号缺失,请重新体检" };
    const next = fixPathInFile(text, lineNo, oldP, newP);
    if (next === null) return { ok: false, note: "文件已变化,行号对不上;请重新体检" };
    return writeJournaled("修路径", finding.file, text, next);
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** missing「写进 AGENTS.md」:规则行追加到目标文件文末(幂等=已含该行则原样)。 */
export async function applyFindingWrite(finding: StaticFinding): Promise<ActionResult> {
  try {
    const text = await readText(finding.file);
    if (text === null) return { ok: false, note: "规则文件读不到,请重新体检" };
    const next = appendRuleLine(text, finding.text);
    if (next === text) return { ok: true, note: "" };
    return writeJournaled("写进 AGENTS.md", finding.file, text, next);
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** 生成 pre-commit 钩子(命令守卫:已含该命令则跳过;新建带 shebang + chmod)。 */
export async function applyRuleHook(cwd: string, row: LintRow): Promise<ActionResult> {
  try {
    const r = await applyHook(cwd, row.rule);
    return { ok: r.ok, note: r.note };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** 备份恢复:把各文件的 .bak-tmdlint 写回原文件(逐文件记应用日志)。 */
export async function applyRestore(paths: string[]): Promise<ActionResult> {
  try {
    const journal: ApplyRecord[] = [];
    for (const p of paths) {
      const before = await readText(p).catch(() => null);
      const bak = await ipc.fsReadFile(`${p}.bak-tmdlint`).catch(() => null);
      if (bak === null || before === null) continue;
      journal.push({ at: Date.now(), kind: "恢复备份", path: p, before, after: bak });
    }
    const results = await restoreBackups(paths);
    await addApplyRecords(journal.filter((_, i) => results[i]?.ok));
    return results.every((r) => r.ok)
      ? { ok: true, note: "" }
      : { ok: false, note: "部分文件恢复失败(备份缺失或写盘失败)" };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** 撤销一条应用记录:把 before 写回文件(记「撤销应用」日志,可再撤销)。 */
export async function applyUndoRecord(rec: ApplyRecord): Promise<ActionResult> {
  try {
    const before = await readText(rec.path);
    if (before === null) return { ok: false, note: "文件读不到" };
    return writeJournaled("撤销应用", rec.path, before, rec.before);
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

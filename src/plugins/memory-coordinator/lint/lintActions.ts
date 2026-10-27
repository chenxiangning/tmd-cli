/**
 * 行内动作编排 —— 建议(删除/归档/收口 stub/修路径/写进 AGENTS.md/上 hook/
 * 备份恢复)到真实写盘的桥。全部走 applyLint 的安全件:重读现文 → 原文匹配
 * 守卫 → 先备份后写;归档随删行把原文追加进 docs/agents-archive.md;破坏性
 * 动作由调用方先过 ConfirmDialog(带 diff/hook 块预览),本模块不重复确认。
 */

import { ipc } from "@kernel/ipc";
import {
  appendArchive, applyEdits, applyHook, appendRuleLine, fixPathInFile,
  removeRuleFromFile, restoreBackups, stubEdit,
} from "./applyLint";
import type { LintAdvice, LintRow, StaticFinding } from "./lintTypes";

export interface ActionResult {
  ok: boolean;
  /** 展示给用户的失败原因(成功为空串)。 */
  note: string;
}

async function readText(path: string): Promise<string | null> {
  return ipc.fsReadFile(path).catch(() => null);
}

/** 按建议处理一条规则(remove/archive)。 */
export async function applyRuleAdvice(cwd: string, row: LintRow, advice: LintAdvice): Promise<ActionResult> {
  if (advice !== "remove" && advice !== "archive") return { ok: false, note: "" };
  try {
    const text = await readText(row.rule.file);
    if (text === null) return { ok: false, note: "规则文件读不到,请重新体检" };
    const next = removeRuleFromFile(text, row.rule, advice === "archive");
    if (next === null) return { ok: false, note: "文件已变化,行号对不上;请重新体检" };
    const results = await applyEdits([{ path: row.rule.file, newText: next }]);
    if (!results[0]?.ok) return { ok: false, note: "写盘失败" };
    if (advice === "archive") {
      const archived = await appendArchive(cwd, [row.rule.text.replace(/\n+/g, " ")]);
      if (!archived) return { ok: true, note: "已删行,但归档文件写入失败" };
    }
    return { ok: true, note: "" };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** drift 收口:CLAUDE.md 整文件替换为 stub 声明。 */
export async function applyFindingStub(finding: StaticFinding): Promise<ActionResult> {
  try {
    const results = await applyEdits([stubEdit(finding)]);
    return results[0]?.ok ? { ok: true, note: "" } : { ok: false, note: "写盘失败" };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** stale+fixpath:行内旧路径替换为仓库唯一同名命中(extra = "old=>new";
 *  行号取自发现 id 第三段,与 stale 产出口径一致)。 */
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
    const results = await applyEdits([{ path: finding.file, newText: next }]);
    return results[0]?.ok ? { ok: true, note: "" } : { ok: false, note: "写盘失败" };
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
    const results = await applyEdits([{ path: finding.file, newText: next }]);
    return results[0]?.ok ? { ok: true, note: "" } : { ok: false, note: "写盘失败" };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** 生成 pre-commit 钩子(命令守卫:已含该命令则跳过;新建带 shebang + chmod)。 */
export async function applyRuleHook(cwd: string, row: LintRow): Promise<ActionResult> {
  try {
    return await applyHook(cwd, row.rule);
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/** 备份恢复:把各文件的 .bak-tmdlint 写回原文件(备份保留,可反复恢复)。 */
export async function applyRestore(paths: string[]): Promise<ActionResult> {
  try {
    const results = await restoreBackups(paths);
    return results.every((r) => r.ok)
      ? { ok: true, note: "" }
      : { ok: false, note: "部分文件恢复失败(备份缺失或写盘失败)" };
  } catch (e) {
    return { ok: false, note: String(e).slice(0, 120) };
  }
}

/**
 * 行内动作编排 —— 建议(删除/归档/收口 stub)到真实写盘的桥。
 * 全部走 applyLint 的安全件:重读现文 → 原文匹配守卫 → 先备份后写;
 * 归档随删行把原文追加进 docs/agents-archive.md。破坏性动作(删除/收口)
 * 由调用方先过 ConfirmDialog,本模块不重复确认。
 */

import { ipc } from "@kernel/ipc";
import { appendArchive, applyEdits, removeRuleFromFile, stubEdit } from "./applyLint";
import type { LintAdvice, LintRow, StaticFinding } from "./lintTypes";

export interface ActionResult {
  ok: boolean;
  /** 展示给用户的失败原因(成功为空串)。 */
  note: string;
}

/** 按建议处理一条规则(remove/archive;fixpath 本期无同名搜索不产出)。 */
export async function applyRuleAdvice(cwd: string, row: LintRow, advice: LintAdvice): Promise<ActionResult> {
  if (advice !== "remove" && advice !== "archive") return { ok: false, note: "" };
  try {
    const text = await ipc.fsReadFile(row.rule.file);
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

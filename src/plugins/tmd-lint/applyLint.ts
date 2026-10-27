/**
 * 写回 —— 按建议动作改规则文件(移植 tmd-lint apply.rs/apply_archive.rs 安全件):
 * 行级操作先做「原文匹配守卫」(当前行 trim 后必须与体检时一致,防体检后文件
 * 已被手改而错删);落盘前先写 `{path}.bak-tmdlint` 备份(每文件本会话一份);
 * archive 删行后在原位留占位符(连续归档块只留一个),并把原文追加进
 * docs/agents-archive.md。hook 生成与历史恢复链不在本期(见 spec)。
 */

import { ipc } from "@kernel/ipc";
import type { RuleItem, StaticFinding } from "./lintTypes";

const ARCHIVE_PLACEHOLDER = "(原规则已迁至 docs/agents-archive.md)";
export const CLAUDE_STUB = "本仓规则唯一事实源:AGENTS.md。本文件已收口为 stub,不再维护。\n";

const backedUp = new Set<string>();

async function backupOnce(path: string): Promise<void> {
  if (backedUp.has(path)) return;
  const original = await ipc.fsReadFile(path).catch(() => null);
  if (original === null) return;
  const ok = await ipc.fsWriteFile(`${path}.bak-tmdlint`, original).then(() => true, () => false);
  if (ok) backedUp.add(path);
}

/** 仅供测试复位备份水位。 */
export function resetBackupsForTest(): void {
  backedUp.clear();
}

export interface FileEdit {
  path: string;
  newText: string;
}

/** 纯变换:从文件文本中按行号删规则(守卫=块 trim 与规则原文一致)。 */
export function removeRuleFromFile(text: string, rule: RuleItem, archive: boolean): string | null {
  const lines = text.split("\n");
  const i = rule.line - 1;
  const end = rule.lineEnd; /* 含 */
  const block = lines.slice(i, end).map((l) => l.trim()).join("\n");
  if (block !== rule.text.trim()) return null; /* 守卫:文件已变,拒绝落笔 */
  const isTable = rule.lineEnd > rule.line;
  let replacement: string[] = [];
  if (archive && !isTable) replacement = [ARCHIVE_PLACEHOLDER];
  const prev = lines[i - 1]?.trim();
  if (archive && !isTable && prev === ARCHIVE_PLACEHOLDER) replacement = []; /* 连续归档只留一个占位 */
  lines.splice(i, end - i, ...replacement);
  return lines.join("\n");
}

/** 批量落盘:先备份后写;各文件相互独立并行落盘,单文件失败不阻塞其余。 */
export async function applyEdits(edits: FileEdit[]): Promise<{ path: string; ok: boolean }[]> {
  return Promise.all(
    edits.map(async (e) => {
      await backupOnce(e.path);
      const ok = await ipc.fsWriteFile(e.path, e.newText).then(() => true, () => false);
      return { path: e.path, ok };
    }),
  );
}

/** 归档迁移:把规则原文逐行追加进 docs/agents-archive.md(已有则续写)。 */
export async function appendArchive(cwd: string, texts: string[]): Promise<boolean> {
  if (texts.length === 0) return true;
  const path = `${cwd}/docs/agents-archive.md`;
  let base = "";
  try {
    const cur = await ipc.fsReadFile(path);
    base = cur.endsWith("\n") || cur === "" ? cur : `${cur}\n`;
  } catch {
    base = "# AGENTS.md 迁出规则归档(tmd-lint)\n";
  }
  const addition = texts.map((t) => `- ${t.replace(/\n+/g, " ")}\n`).join("");
  return ipc.fsWriteFile(path, `${base}${base.endsWith("\n") || base === "" ? "" : "\n"}${addition}`).then(() => true, () => false);
}

/** 归档原文收集:archive 建议采纳时随删行一并入档的文本。 */
export function archiveTextsOf(rules: RuleItem[]): string[] {
  return rules.map((r) => r.text.replace(/\n+/g, " "));
}

/** drift 的 stub 收口:整文件替换为声明行。 */
export function stubEdit(finding: StaticFinding): FileEdit {
  return { path: finding.file, newText: CLAUDE_STUB };
}

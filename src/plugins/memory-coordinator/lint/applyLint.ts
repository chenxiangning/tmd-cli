/**
 * 写回 —— 按建议动作改规则文件(移植 tmd-lint apply.rs/apply_archive.rs 安全件):
 * 行级操作先做「原文匹配守卫」(当前行 trim 后必须与体检时一致,防体检后文件
 * 已被手改而错删);落盘前先写 `{path}.bak-tmdlint` 备份(每文件本会话一份);
 * archive 删行后在原位留占位符(连续归档块只留一个),并把原文追加进
 * docs/agents-archive.md;另含 fixpath 改写、missing 追加、pre-commit hook
 * 生成(chmod 经 procCommunicate 通用原语)与 .bak-tmdlint 恢复。
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

/**
 * 文本锚定定位(行号漂移根治):行号处命中规则原文就用行号;失配则按 trim 原文
 * 全文搜索——唯一命中直接用,多命中取距原行号最近者(歧义最小),零命中判失败。
 * 这样此前应用造成的行号漂移不阻断后续应用;只有规则文本真被手改/删除才拒。
 */
function anchorLine(lines: string[], rule: RuleItem): number {
  const want = rule.text.trim();
  if (want === "") return -1; /* 空文本规则无法锚定,拒绝猜测 */
  if ((lines[rule.line - 1]?.trim() ?? "") === want) return rule.line - 1;
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) if ((lines[i]?.trim() ?? "") === want) hits.push(i);
  if (hits.length === 0) return -1;
  if (hits.length === 1) return hits[0]!;
  return hits.reduce((best, i) => (Math.abs(i - (rule.line - 1)) < Math.abs(best - (rule.line - 1)) ? i : best), hits[0]!);
}

/** 多行块锚定:行号块守卫失败则滑动窗口按块文本(逐行 trim join)全文唯一匹配。 */
function anchorBlock(lines: string[], rule: RuleItem): number {
  const span = rule.lineEnd - rule.line + 1;
  const want = rule.text.trim();
  if (want === "") return -1; /* 空文本规则无法锚定 */
  const blockAt = (i: number) => lines.slice(i, i + span).map((l) => l.trim()).join("\n");
  if (rule.line - 1 + span <= lines.length && blockAt(rule.line - 1) === want) return rule.line - 1;
  const hits: number[] = [];
  for (let i = 0; i + span <= lines.length; i++) if (blockAt(i) === want) hits.push(i);
  if (hits.length === 0) return -1;
  if (hits.length === 1) return hits[0]!;
  return hits.reduce((best, i) => (Math.abs(i - (rule.line - 1)) < Math.abs(best - (rule.line - 1)) ? i : best), hits[0]!);
}

/** 纯变换:从文件文本中删规则(守卫=块文本锚定,行号漂移可自愈)。 */
export function removeRuleFromFile(text: string, rule: RuleItem, archive: boolean): string | null {
  const lines = text.split("\n");
  const i = anchorBlock(lines, rule);
  if (i < 0) return null; /* 规则文本已不存在,拒绝猜测 */
  const end = i + (rule.lineEnd - rule.line) + 1; /* 含 */
  const isTable = rule.lineEnd > rule.line;
  let replacement: string[] = [];
  if (archive && !isTable) replacement = [ARCHIVE_PLACEHOLDER];
  const prev = lines[i - 1]?.trim();
  if (archive && !isTable && prev === ARCHIVE_PLACEHOLDER) replacement = []; /* 连续归档只留一个占位 */
  lines.splice(i, end - i, ...replacement);
  return lines.join("\n");
}

/** 纯变换:AI 改写应用(文本锚定定位目标行;表格块不支持改写)。 */
export function replaceRuleFromFile(text: string, rule: RuleItem, rewrite: string): string | null {
  if (rule.lineEnd > rule.line) return null;
  const lines = text.split("\n");
  const i = anchorLine(lines, rule);
  if (i < 0) return null;
  lines[i] = rewrite;
  return lines.join("\n");
}

/** 纯变换:fixpath 替换行内首个旧路径(守卫=锚定行含旧路径:行号优先,失配则全文唯一含旧路径行)。 */
export function fixPathInFile(text: string, line: number, oldP: string, newP: string): string | null {
  const lines = text.split("\n");
  let i = line - 1;
  if ((lines[i] ?? "").includes(oldP) === false) {
    const hits: number[] = [];
    for (let k = 0; k < lines.length; k++) if ((lines[k] ?? "").includes(oldP)) hits.push(k);
    if (hits.length === 0) return null;
    i = hits.length === 1 ? hits[0]! : hits.reduce((best, k) => (Math.abs(k - (line - 1)) < Math.abs(best - (line - 1)) ? k : best), hits[0]!);
  }
  lines[i] = lines[i]!.replace(oldP, newP);
  return lines.join("\n");
}

/** 纯变换:missing 追加一条规则行到文末(缺空行先补;幂等=已含该行则原样)。 */
export function appendRuleLine(text: string, line: string): string {
  const t = line.trim();
  if (text.split("\n").some((l) => l.trim() === t || l.trim() === `- ${t}`)) return text;
  const base = text.endsWith("\n") ? text : `${text}\n`;
  const sep = text.trim() === "" ? "" : text.endsWith("\n\n") ? "" : "\n";
  return `${base}${sep}- ${t}\n`;
}

/** pre-commit 追加块(移植 apply_build.rs hook 合并口径,按命令守卫已存在)。 */
export function buildHookBlock(rule: RuleItem): string {
  const cmd = rule.text.match(/(pnpm|npx|npm|cargo|make|go)\s+[A-Za-z0-9 ._:\-/@]+/)?.[0]?.trim() ?? "";
  const first = rule.text.split("\n")[0]!.replace(/["`\\]/g, "");
  return `if ! ${cmd} >/dev/null 2>&1; then echo "规则拦截: ${first}"; exit 1; fi\n`;
}

/** hook 落盘:pre-commit 不存在=带 shebang 新建,存在=追加块(已含命令则跳过)。
 *  可执行位经 procCommunicate chmod 通用原语(内核无 chmod 专用原语)。 */
export async function applyHook(cwd: string, rule: RuleItem): Promise<{ ok: boolean; note: string }> {
  const block = buildHookBlock(rule);
  const cmd = block.slice(5, block.indexOf(">/dev/null")).trim();
  const path = `${cwd}/.git/hooks/pre-commit`;
  let cur: string | null = null;
  try {
    cur = await ipc.fsReadFile(path);
  } catch {
    cur = null;
  }
  let next: string;
  if (cur === null) next = `#!/bin/sh\n${block}`;
  else {
    if (cur.includes(cmd)) return { ok: false, note: "pre-commit 已含该命令,无需重复" };
    const base = cur.endsWith("\n") || cur === "" ? cur : `${cur}\n`;
    next = `${base}${block}`;
  }
  await backupOnce(path);
  const ok = await ipc.fsWriteFile(path, next).then(() => true, () => false);
  if (ok) {
    await ipc
      .procCommunicate({ command: "chmod", args: ["+x", path], cwd, timeoutMs: 8000 })
      .catch(() => {});
  }
  return { ok, note: ok ? "" : "写盘失败" };
}

/** 备份恢复:把各文件的 .bak-tmdlint 写回原文件(备份保留,可再恢复)。 */
export async function restoreBackups(paths: string[]): Promise<{ path: string; ok: boolean }[]> {
  return Promise.all(
    paths.map(async (p) => {
      const bak = await ipc.fsReadFile(`${p}.bak-tmdlint`).catch(() => null);
      if (bak === null) return { path: p, ok: false };
      const ok = await ipc.fsWriteFile(p, bak).then(() => true, () => false);
      return { path: p, ok };
    }),
  );
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

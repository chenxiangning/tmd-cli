/**
 * docgen 视图帮手(纯函数;.ts 守 only-export-components):
 * 行元数据文案 / 分组 / 转任务目标项目解析 / 追问 prompt。
 */
import { t } from "@kernel/i18n";
import type { DocGenEntry } from "./docgen/types";
import type { DocGenTask } from "./docgen/queue";

/** 文档状态机文案键(列表行徽与阅读器头共用;t() 于使用处)。 */
export const DOC_STATE_KEYS: Record<DocGenEntry["docState"], string> = {
  draft: "草稿",
  reported: "已汇报",
  archived: "已归档",
};

/** 行状态徽文案(gen 态叠加队列实时文案)。 */
export function statusChip(entry: DocGenEntry, task?: DocGenTask): { cls: string; text: string } {
  if (entry.status === "gen") {
    const live = task && (task.st === "queue" || task.st === "run") ? task.text : t("生成中");
    return { cls: "gen", text: live };
  }
  if (entry.status === "fail") return { cls: "fail", text: t("失败") };
  const v = entry.versions[entry.versions.length - 1];
  return { cls: "ok", text: t("完成 v{v}", { v: v?.v ?? 0 }) };
}

/** 行 meta 文案:引擎 · 周期 · 范围 ·(版本时间)。 */
export function rowMeta(entry: DocGenEntry): string {
  const scopeText = entry.scope.kind === "one" ? entry.scope.projectName : t("全部项目");
  const parts = [entry.engine, entry.periodLabel, scopeText];
  const latest = entry.versions[entry.versions.length - 1];
  if (latest) parts.push(latest.at.slice(5, 16).replace("T", " "));
  else if (entry.error) parts.push(entry.error.slice(0, 30));
  return parts.join(" · ");
}

/** 列表分组:今天 / 更早(以 updatedAt 自然日切)。 */
export function groupEntries(entries: readonly DocGenEntry[], today: string): { today: DocGenEntry[]; earlier: DocGenEntry[] } {
  const today_: DocGenEntry[] = [];
  const earlier: DocGenEntry[] = [];
  for (const e of entries) (e.updatedAt.slice(0, 10) === today ? today_ : earlier).push(e);
  return { today: today_, earlier };
}

/** 转任务/存文档目标项目:单项目范围直落;全部范围落第一个「进行中」,否则第一个。 */
export function resolveTargetProjectId(entry: DocGenEntry, projects: ReadonlyArray<{ id: string; name: string; status: string }>): { projectId: string; projectName: string; fallback: boolean } {
  if (entry.scope.kind === "one") return { projectId: entry.scope.projectId, projectName: entry.scope.projectName, fallback: false };
  const doing = projects.find((p) => p.status === "进行中") ?? projects[0];
  return doing
    ? { projectId: doing.id, projectName: doing.name, fallback: entry.scope.kind === "all" }
    : { projectId: "", projectName: "", fallback: false };
}

/** 就此追问 prompt(全文随行,新会话有完整上下文)。 */
export function buildAskPrompt(entry: DocGenEntry, md: string): string {
  return [
    `我就《${entry.title}》继续追问。以下是文档全文,先读再答;引用文档内容时注明小节。`,
    "",
    "---",
    "",
    md,
  ].join("\n");
}

/** 阅读器头 meta 文案。 */
export function readerMeta(entry: DocGenEntry, v: number | null): string {
  const ver = v === null ? entry.versions[entry.versions.length - 1] : entry.versions.find((x) => x.v === v);
  if (!ver) return entry.engine;
  return `v${ver.v} · ${ver.engine} · ${ver.at.slice(0, 16).replace("T", " ")}`;
}

/* ── 结构化区块 · 转任务条目(纯构造;DocGenBlocks/Reader 共用) ── */

export type TransferKind = "risk" | "action" | "suggestion";

/** 转任务条目规范化(Reader 落 addTask 用)。 */
export interface TransferItem {
  kind: TransferKind;
  key: string;
  text: string;
  owner?: string;
  due?: string;
  src?: string;
}

export function transferKey(kind: TransferKind, text: string): string {
  return `${kind}:${text}`;
}

export function riskToItem(r: { level: string; text: string; src?: string }): TransferItem {
  return { kind: "risk", key: transferKey("risk", r.text), text: `${r.level} 风险:${r.text}`, src: r.src };
}

export function actionToItem(a: { text: string; owner?: string; due?: string; src?: string }): TransferItem {
  return { kind: "action", key: transferKey("action", a.text), text: a.text, owner: a.owner, due: a.due, src: a.src };
}

export function suggestionToItem(s: { text: string }): TransferItem {
  return { kind: "suggestion", key: transferKey("suggestion", s.text), text: `建议:${s.text}` };
}

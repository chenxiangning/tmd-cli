/**
 * 触发器下拉的"查找候选"逻辑 —— 与 UI 分离,纯函数。
 *
 * 三类触发符(2026-09-04 起数据源以 CLI 为真相源,见
 * docs/superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md):
 * - @ (file):cli-shared/fileIndex(Rust fs_walk_files 全仓索引 + 客户端模糊),
 *   根 = 会话 workspace root(修复旧实现落到进程 cwd 只见根目录的 bug)
 * - / (command) 与 $ (skill):profile.listSuggestions(CLI 查询/磁盘扫描)
 *   与静态表按 value 去重合并(drawerItems.mergeSuggestions 共用语义);
 *   无 provider 或失败 = 纯静态
 */

import type { CliProfile, CliSuggestion, CliTriggerSpec, TriggerKind } from "@kernel/cli";
import { fuzzyFileMatch, projectFileIndex } from "../../cli-shared/fileIndex";
import { mergeSuggestions } from "../drawerItems";

/** 下拉候选上限:与 CLI 原生补全面板量级一致,太多反而不可扫读。 */
const MAX_CANDIDATES = 20;

export interface SuggestionMatch {
  /** 替换进文本的值(不含 char)。 */
  value: string;
  /** 下拉的描述文本。 */
  description?: string;
  /** file 时携带的绝对路径,用于 hint;非 file 留空。 */
  detail?: string;
  /** 候选所属触发类别 —— 候选面板的分区标题/展示前缀用(同一次查询内一致)。 */
  kind?: TriggerKind;
}

/**
 * 当前激活会话触发器在当前 text + cursor 上的查询。
 * 返回命中的 trigger 描述 + 候选列表。
 */
export async function lookupSuggestions(
  profile: CliProfile,
  triggerSpec: CliTriggerSpec,
  tokenText: string,
  cwd: string,
): Promise<SuggestionMatch[]> {
  const needle = tokenText.slice(triggerSpec.char.length);
  switch (triggerSpec.kind) {
    case "command":
    case "skill":
      return filterDeclared(await declaredPlusDynamic(profile, triggerSpec.kind, cwd), needle, triggerSpec.kind);
    case "file":
      return matchFiles(needle, cwd);
  }
}

/** 静态表 × listSuggestions 合并;provider 失败 = 纯静态(合并层只增不顶替)。 */
async function declaredPlusDynamic(
  profile: CliProfile,
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[]> {
  const declared = profile.suggestions?.[kind] ?? [];
  if (!profile.listSuggestions) return declared;
  const dynamic = await profile.listSuggestions(kind, cwd).catch(() => null);
  return dynamic ? mergeSuggestions(declared, dynamic) : declared;
}

/** 前缀过滤(大小写不敏感);空 needle = 全量(截到上限)。 */
function filterDeclared(
  list: readonly CliSuggestion[],
  needle: string,
  kind: "command" | "skill",
): SuggestionMatch[] {
  const lower = needle.toLowerCase();
  return list
    .filter((s) => s.value.toLowerCase().startsWith(lower))
    .slice(0, MAX_CANDIDATES)
    .map<SuggestionMatch>((s) => ({ value: s.value, description: s.description, kind }));
}

/** @ 候选:全仓相对路径模糊匹配;目录带尾 /(applyPick 插入后可继续下钻)。 */
async function matchFiles(needle: string, cwd: string): Promise<SuggestionMatch[]> {
  if (!cwd) return [];
  const files = await projectFileIndex(cwd);
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return fuzzyFileMatch(files, needle, MAX_CANDIDATES).map<SuggestionMatch>((path) => ({
    value: path,
    description: path.endsWith("/") ? "目录" : undefined,
    detail: `${base}${path}`,
    kind: "file",
  }));
}

/**
 * 触发器下拉的"查找候选"逻辑 —— 与 UI 分离,纯函数。
 *
 * 三类 CLI 触发符(2026-09-04 起数据源以 CLI 为真相源,见
 * docs/superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md):
 * - @ (file):triggers/fileIndex(Rust fs_walk_files 全仓索引 + 客户端模糊,插件内部件),
 *   根 = 会话 workspace root(修复旧实现落到进程 cwd 只见根目录的 bug)
 * - / (command) 与 $ (skill):profile.listSuggestions(CLI 查询/磁盘扫描)
 *   与静态表按 value 去重合并(drawerItems.mergeSuggestions 共用语义);
 *   无 provider 或失败 = 纯静态
 * 另有 CLI 无关的 ext 触发源(kernel composerExt 注册表,如 assets 的 !! ##):
 * 同步 list + 子串过滤(前缀优先),insertText/onPick 在装配时解析。
 */

import type { CliProfile, CliSuggestion, CliTriggerSpec, TriggerKind } from "@kernel/cli";
import type { ComposerTriggerSource } from "@kernel/composerExt";
import { t } from "@kernel/i18n";
import { fuzzyFileMatch, projectFileIndex } from "./fileIndex";
import { mergeSuggestions, installedSkillsForProfile } from "../drawerItems";

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
  /** ext 触发源:覆盖分区标题与触发符前缀(分组名 / 多字符触发符)。 */
  group?: string;
  char?: string;
  /** 选中后替换 token 的完整文本(ext 源 insertText;缺省 = char + value)。 */
  insertText?: string;
  /** 选中副作用(ext 源 onPick;sessionId 由 applyPick 在选中时注入)。 */
  onPick?: (sessionId: string | null) => void;
}

/**
 * 当前激活会话触发器在当前 text + cursor 上的查询。
 * 返回命中的 trigger 描述 + 候选列表。
 */
export async function lookupSuggestions(
  profile: CliProfile,
  triggerSpec: CliTriggerSpec | ComposerTriggerSource,
  tokenText: string,
  cwd: string,
): Promise<SuggestionMatch[]> {
  const needle = tokenText.slice(triggerSpec.char.length);
  /* ext 触发源(kernel composerExt 注册表,CLI 无关):同步 list + 子串过滤 */
  if ("list" in triggerSpec) return extMatches(triggerSpec, needle, cwd);
  switch (triggerSpec.kind) {
    case "command":
    case "skill":
      return filterDeclared(await declaredPlusDynamic(profile, triggerSpec.kind, cwd), needle, triggerSpec.kind);
    case "file":
      return matchFiles(needle, cwd);
  }
}

/** ext 源候选装配:insertText/onPick 在此解析(cwd 可用),与静态表同上限。 */
function extMatches(
  src: ComposerTriggerSource,
  needle: string,
  cwd: string,
): SuggestionMatch[] {
  const lower = needle.toLowerCase();
  return src
    .list(cwd)
    .map((s) => ({ s, r: matchRank(s.value, lower) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, MAX_CANDIDATES)
    .map<SuggestionMatch>((m) => ({
      value: m.s.value,
      description: m.s.description,
      group: src.label,
      char: src.char,
      insertText: src.insertText
        ? src.insertText(m.s, cwd)
        : src.onPick
          ? ""
          : src.char + m.s.value,
      onPick: src.onPick ? (sessionId) => src.onPick?.(m.s, sessionId) : undefined,
    }));
}

/** 静态表 × listSuggestions 合并;provider 失败 = 纯静态(合并层只增不顶替)。
 *  skill 叠加通用聚合(十家目录跨 CLI,2026-09-28 通用技能关联 spec)。 */
async function declaredPlusDynamic(
  profile: CliProfile,
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[]> {
  const declared = profile.suggestions?.[kind] ?? [];
  if (!profile.listSuggestions) {
    return kind === "skill" && profile.triggers.some((t) => t.kind === "skill")
      ? mergeSuggestions(declared, await installedSkillsForProfile(profile))
      : declared;
  }
  const dynamic = await profile.listSuggestions(kind, cwd).catch((e) => {
    console.warn("[suggest] listSuggestions 抛错:", profile.id, kind, e);
    return null;
  });
  const base = dynamic ? mergeSuggestions(declared, dynamic) : declared;
  return kind === "skill"
    ? mergeSuggestions(base, await installedSkillsForProfile(profile))
    : base;
}

/** 子串命中分级(大小写不敏感):0 = 前缀命中排前,1 = 任意位置命中,-1 = 不命中。 */
function matchRank(value: string, lower: string): number {
  const v = value.toLowerCase();
  return v.startsWith(lower) ? 0 : v.includes(lower) ? 1 : -1;
}

/** 子串过滤(大小写不敏感,任意位置命中);前缀命中排前,空 needle = 全量(截到上限)。 */
function filterDeclared(
  list: readonly CliSuggestion[],
  needle: string,
  kind: "command" | "skill",
): SuggestionMatch[] {
  const lower = needle.toLowerCase();
  return list
    .map((s) => ({ s, r: matchRank(s.value, lower) }))
    .filter((m) => m.r >= 0)
    .sort((a, b) => a.r - b.r)
    .slice(0, MAX_CANDIDATES)
    .map<SuggestionMatch>((m) => ({ value: m.s.value, description: m.s.description, kind }));
}

/** @ 候选:全仓相对路径模糊匹配;目录带尾 /(applyPick 插入后可继续下钻)。 */
async function matchFiles(needle: string, cwd: string): Promise<SuggestionMatch[]> {
  if (!cwd) return [];
  const files = await projectFileIndex(cwd);
  const base = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return fuzzyFileMatch(files, needle, MAX_CANDIDATES).map<SuggestionMatch>((path) => ({
    value: path,
    description: path.endsWith("/") ? t("文件夹") : undefined,
    detail: `${base}${path}`,
    kind: "file",
  }));
}

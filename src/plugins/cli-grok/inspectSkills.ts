/**
 * grok 技能真相查询 ── `grok inspect --json` 非交互枚举。
 *
 * 2026-09-04 实测(grok 1.0.13,0.23s):顶层 skills[] = {name, description,
 * source, userInvocable, invocableAs, collidesWith};inspect 不含内置斜杠命令
 * (命令真相不可枚举 → command kind 回退静态表,不实现)。
 */

import type { CliSuggestion } from "@kernel/cli";
import { CachedCliQuery, queryCliRawJson } from "../cli-shared/cliQuery";

interface GrokInspectSkill {
  name?: string;
  /** 实际可调用名;与内置/其他技能撞名时带限定前缀(如 local:x)。 */
  invocableAs?: string;
  description?: string;
  /** false = 纯参考技能,不对用户暴露。 */
  userInvocable?: boolean;
}

/** inspect 冷启动很快(实测 0.23s),缓存主要防抖击键与抽屉重复拉。 */
const TTL_MS = 5 * 60_000;

async function fetchGrokSkills(cwd: string): Promise<CliSuggestion[] | null> {
  const inspect = await queryCliRawJson({ command: "grok", args: ["inspect", "--json"], cwd });
  const skills = (inspect as { skills?: GrokInspectSkill[] } | null)?.skills;
  if (!Array.isArray(skills)) return null;
  return skills
    .filter((s) => s.userInvocable !== false && s.name)
    .map((s) => ({
      /* 裸 name(非 invocableAs):profile.translate 发送时翻 /skills <name>,
         与静态表/抽屉插入语义一致;撞名限定名场景交给 grok 自己解析 */
      value: s.name!,
      description: s.description,
      action: "insert" as const,
    }));
}

const cached = new CachedCliQuery(fetchGrokSkills, TTL_MS);

/**
 * listSuggestions 契约实现(grok profile 的 skill kind)。
 * command kind 不可枚举 → 恒 null(静态表兜底);inspect 失败 = null。
 */
export async function listGrokSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  if (kind !== "skill") return null;
  return cached.get(cwd);
}

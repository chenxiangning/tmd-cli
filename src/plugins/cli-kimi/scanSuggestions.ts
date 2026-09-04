/**
 * kimi 技能磁盘发现 ── kimi 无独立命令概念(技能即命令 /skill:<name>),
 * 无列举子命令(只有 headless prompt/ACP),按官方四层发现规则扫磁盘:
 * - `<cwd>/.kimi-code/skills` + `~/.kimi-code/skills`(KIMI_CODE_HOME 缺省)+
 *   `~/.agents/skills`(用户级兼容层);
 * - 目录式 `<name>/SKILL.md` 与平铺式 `<name>.md` 双形态(cli-shared/skillDirs);
 * - config.toml extra_skill_dirs 不扫:目录清单是用户私有配置,读 TOML 属
 *   越权猜测,漏项可接受(cli-shared 惯例:宁可少不可错)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { CachedCliQuery } from "../cli-shared/cliQuery";
import { scanSkillDirs } from "../cli-shared/skillDirs";

async function fetchSkills(cwd: string): Promise<CliSuggestion[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  return scanSkillDirs([
    `${cwd}/.kimi-code/skills`,
    `${home}/.kimi-code/skills`,
    `${home}/.agents/skills`,
  ]);
}

const skillCache = new CachedCliQuery(fetchSkills, 60_000);

/**
 * listSuggestions 契约实现(kimi profile)。
 * command kind 无自定义机制 → 恒 null,静态表兜底。
 */
export function listKimiSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  return kind === "skill" ? skillCache.get(cwd) : Promise.resolve(null);
}

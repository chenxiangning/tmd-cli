/**
 * qoder 命令/技能磁盘发现 ── 国际版(cli-qoder)与国内版(cli-qoder-cn)共享。
 * qodercli 无 JSON 列举子命令(skills list 纯文本,解析漂移风险大于目录扫描,
 * spec D2 取舍),按官方发现规则扫磁盘:
 * - 命令:`<cwd>/.qoder/commands` + `~/.qoder/commands`(递归 .md、冒号命名
 *   空间、SKILL.md 目录单命令,cli-shared/mdCommands);
 * - 技能:`~/.qoder/skills` + `<cwd>/.qoder/skills` + 兼容层 `.agents/skills`
 *   (settings skills.loadFromAgentsDirectory 默认开),手动触发 `/<name>`。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { CachedCliQuery } from "./cliQuery";
import { scanCommandMdDirs } from "./mdCommands";
import { scanSkillDirs } from "./skillDirs";

async function fetchCommands(cwd: string): Promise<CliSuggestion[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  return scanCommandMdDirs([`${cwd}/.qoder/commands`, `${home}/.qoder/commands`]);
}

async function fetchSkills(cwd: string): Promise<CliSuggestion[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  return scanSkillDirs([
    `${cwd}/.qoder/skills`,
    `${home}/.qoder/skills`,
    `${cwd}/.agents/skills`,
    `${home}/.agents/skills`,
  ]);
}

const commandCache = new CachedCliQuery(fetchCommands, 60_000);
const skillCache = new CachedCliQuery(fetchSkills, 60_000);

/** listSuggestions 契约实现(qoder / qoder-cn 两个 profile 共用)。 */
export function listQoderSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  return kind === "command" ? commandCache.get(cwd) : skillCache.get(cwd);
}

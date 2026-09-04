/**
 * claude 命令/技能磁盘发现 ── claude 无 RPC/子命令列举通道(内置命令编译进
 * 二进制,--help 不含交互命令,2026-09-04 scout 实证),按其官方发现规则扫磁盘:
 * - 命令:`<cwd>/.claude/commands` + `~/.claude/commands`(项目级覆盖用户级)
 *   + 插件缓存 commands,递归 .md、冒号命名空间(cli-shared/mdCommands);
 * - 技能:`<cwd>/.claude/skills` + `~/.claude/skills` + 插件缓存 skills,
 *   `<name>/SKILL.md`(cli-shared/skillDirs);
 * - 插件:`~/.claude/plugins/installed_plugins.json` 的 plugins.*[].installPath
 *   (v2 实证形状),其 commands/ 与 skills/ 目录按上两层同规则并入。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { CachedCliQuery } from "../cli-shared/cliQuery";
import { scanCommandMdDirs } from "../cli-shared/mdCommands";
import { scanSkillDirs } from "../cli-shared/skillDirs";

async function home(): Promise<string | null> {
  return ipc.configHomeDir().catch(() => null);
}

/** 已装插件的 installPath 清单(解析失败 = 无插件区,不拖垮用户级/项目级)。 */
async function claudePluginRoots(): Promise<string[]> {
  const dir = await home();
  if (!dir) return [];
  const raw = await ipc.fsReadFile(`${dir}/.claude/plugins/installed_plugins.json`).catch(() => "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { plugins?: Record<string, Array<{ installPath?: string }>> };
    return Object.values(parsed.plugins ?? {}).flatMap((entries) =>
      entries.map((e) => e.installPath).filter((p): p is string => Boolean(p)),
    );
  } catch {
    return [];
  }
}

async function fetchCommands(cwd: string): Promise<CliSuggestion[]> {
  const dir = await home();
  if (!dir) return [];
  const roots = (await claudePluginRoots()).map((p) => `${p}/commands`);
  return scanCommandMdDirs([`${cwd}/.claude/commands`, `${dir}/.claude/commands`, ...roots]);
}

async function fetchSkills(cwd: string): Promise<CliSuggestion[]> {
  const dir = await home();
  if (!dir) return [];
  const roots = (await claudePluginRoots()).map((p) => `${p}/skills`);
  return scanSkillDirs([`${cwd}/.claude/skills`, `${dir}/.claude/skills`, ...roots]);
}

const commandCache = new CachedCliQuery(fetchCommands, 60_000);
const skillCache = new CachedCliQuery(fetchSkills, 60_000);

/**
 * listSuggestions 契约实现(claude profile)。磁盘扫描永不大面积失败
 * (单目录失败 = 跳过),返回 [] 表示"无自定义项",静态内置表继续由合并层叠加。
 */
export function listClaudeSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  return kind === "command" ? commandCache.get(cwd) : skillCache.get(cwd);
}

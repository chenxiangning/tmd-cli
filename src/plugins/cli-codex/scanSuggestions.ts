/**
 * codex 技能磁盘发现 ── codex 的自定义斜杠命令(custom prompts ~/.codex/prompts)
 * 自 ~0.117 已废弃不加载(2026-09-04 scout 实证,死配置不扫),用户可调用物 =
 * 技能($<name> mention,composer $ 触发符原生命中):
 * - `<cwd>/.agents/skills` + `~/.codex/skills` + `~/.agents/skills`
 *   (项目级权威根是 .agents/skills;host_roots.rs 取证);
 * - `~/.codex/skills/.system/` 内置系统技能单独作根扫描(路径多一层);
 * - 插件:`~/.codex/plugins/cache/<mp>/<plugin>/<ver>/skills/`(实测形状),
 *   先 walk 出含 /skills/ 段的目录再按常规技能扫描。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { CachedCliQuery } from "../cli-shared/cliQuery";
import { scanSkillDirs } from "../cli-shared/skillDirs";

/** 插件缓存里的技能目录(形状:<mp>/<plugin>/<ver>/skills);上限防误传巨仓。 */
async function codexPluginSkillDirs(home: string): Promise<string[]> {
  const cache = `${home}/.codex/plugins/cache`;
  const entries = await ipc.fsWalkFiles(cache, 4000).catch(() => []);
  const dirs = new Set<string>();
  for (const entry of entries) {
    const cut = entry.indexOf("/skills/");
    if (cut >= 0) dirs.add(`${cache}/${entry.slice(0, cut + "/skills".length)}`);
  }
  return [...dirs];
}

async function fetchSkills(cwd: string): Promise<CliSuggestion[]> {
  const home = await ipc.configHomeDir().catch(() => null);
  if (!home) return [];
  return scanSkillDirs([
    `${cwd}/.agents/skills`,
    `${home}/.codex/skills`,
    `${home}/.codex/skills/.system`,
    `${home}/.agents/skills`,
    ...(await codexPluginSkillDirs(home)),
  ]);
}

const skillCache = new CachedCliQuery(fetchSkills, 60_000);

/**
 * listSuggestions 契约实现(codex profile)。
 * command kind 无真相源(内置不可枚举)→ 恒 null,静态表兜底。
 */
export function listCodexSuggestions(
  kind: "command" | "skill",
  cwd: string,
): Promise<CliSuggestion[] | null> {
  return kind === "skill" ? skillCache.get(cwd) : Promise.resolve(null);
}

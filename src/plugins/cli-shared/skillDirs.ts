/**
 * SKILL.md 技能目录扫描 ── claude / qoder / codex / kimi 四家共享的磁盘发现层。
 *
 * 四家布局同构(2026-09-04 双 scout 实证 + 官方文档对照,详见
 * docs/superpowers/specs/2026-09-04-composer-cli-sourced-suggestions-design.md D2):
 * - 目录式:`<技能目录>/<name>/SKILL.md`,frontmatter name/description(claude/
 *   qoder/kimi 都允许 name 缺省回落目录名);一律一层,技能目录内的
 *   scripts/references/assets 子树不是技能;
 * - 平铺式(仅 kimi):`<技能目录>/<name>.md`,名字取文件名主干;
 * - 多目录按调用方给的优先级去重(同名先到先得),目录不存在/无条目 = 跳过。
 *
 * 消费方各自传目录清单(用户级/项目级/兼容层 ~/.agents/skills),本层不拼路径 ——
 * 家目录取法等 CLI 私有约定留在各插件。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { frontmatterDescription } from "./frontmatter";

/** 单目录扫描上限:技能目录不会有几千项,给异常目录(误传仓库根)设闸。 */
const SCAN_CAP = 2000;

/**
 * 扫描一组技能目录,返回 skill 候选(action 恒 insert:技能注入后要跟任务文本)。
 * 目录读取失败 = 该目录跳过(不拖垮其余目录)。
 */
export async function scanSkillDirs(dirs: readonly string[]): Promise<CliSuggestion[]> {
  /* 动态去重表:同名技能先到先得(目录优先级由调用方顺序表达),
     Map 保序 = 候选出现顺序稳定 */
  const byValue = new Map<string, CliSuggestion>();
  for (const dir of dirs) {
    const entries = await ipc.fsWalkFiles(dir, SCAN_CAP).catch(() => []);
    for (const entry of entries) {
      const parsed = classifySkillEntry(entry);
      if (!parsed || byValue.has(parsed.name)) continue;
      const text = await ipc.fsReadFile(`${dir}/${entry}`).catch(() => "");
      const description = text ? frontmatterDescription(text) : undefined;
      byValue.set(parsed.name, {
        value: parsed.name,
        description: description || parsed.dirName,
        action: "insert",
        icon: "think",
      });
    }
  }
  return [...byValue.values()];
}

/**
 * 条目分型(纯函数,单测 seam):目录式 `<name>/SKILL.md`(一层)或平铺
 * `<name>.md`;其余(SKILL.md 之外的深层附属文件)不是技能。
 */
export function classifySkillEntry(entry: string): { name: string; dirName: string } | null {
  const segments = entry.split("/");
  if (segments.length === 2 && segments[1] === "SKILL.md") {
    return { name: segments[0], dirName: segments[0] };
  }
  if (segments.length === 1 && segments[0].endsWith(".md") && segments[0] !== "SKILL.md") {
    return { name: segments[0].replace(/\.md$/, ""), dirName: segments[0] };
  }
  return null;
}

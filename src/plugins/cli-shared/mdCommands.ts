/**
 * commands/*.md 斜杠命令扫描 ── claude / qoder 共享的磁盘发现层。
 *
 * 两家布局同构(2026-09-04 scout 实证 + 官方文档):
 * - 目录:claude = `~/.claude/commands` + `<proj>/.claude/commands`;qoder =
 *   `~/.qoder/commands` + `<proj>/.qoder/commands`(调用方传优先级序);
 * - 递归 .md,子目录 = 冒号命名空间:`git/commit.md` → `git:commit`;
 * - frontmatter description 必填(claude 解析失败回落正文首行,同款回落);
 *   claude 允许 frontmatter name 覆盖派生名;
 * - qoder 特例:目录内有 SKILL.md = 整目录注册为单命令(如 /git),该目录下
 *   的散装 .md 被忽略 —— 本层按此规则吸收(claude 无此形态,规则不命中即无影响)。
 */

import { ipc } from "@kernel/ipc";
import type { CliSuggestion } from "@kernel/cli";
import { frontmatterDescription, parseFrontmatter } from "@kernel/frontmatter";

/** 单目录扫描上限(防误传仓库根)。 */
const SCAN_CAP = 2000;

/**
 * 扫描一组命令目录,返回 command 候选(action 恒 insert:自定义命令通常要参数)。
 * 目录读取失败 = 跳过;同名命令先到先得(调用方顺序 = 覆盖优先级)。
 */
export async function scanCommandMdDirs(dirs: readonly string[]): Promise<CliSuggestion[]> {
  /* 目录枚举互不依赖,并发 walk;先到先得(覆盖优先级)由下方按 dirs 原序消费保证。 */
  const walkedPerDir = await Promise.all(
    dirs.map((dir) => ipc.fsWalkFiles(dir, SCAN_CAP).catch(() => [] as string[])),
  );
  /* 候选筛选是纯路径规则(不碰文件内容):先按原规则筛出各目录候选。 */
  const candidates = walkedPerDir.flatMap((entries, di) => {
    const dir = dirs[di] ?? "";
    /* qoder 单命令目录:内含 SKILL.md 的目录按整目录一个命令注册,目录下的
       散装 .md 全部忽略;根级 SKILL.md 无命令语义,跳过 */
    const absorbedDirs = new Set(
      entries.flatMap((e) =>
        e.endsWith("/SKILL.md") ? [e.slice(0, -"SKILL.md".length)] : [],
      ),
    );
    return entries.flatMap((entry) => {
      if (!entry.endsWith(".md") || entry === "SKILL.md") return [];
      const holder = entry.slice(0, entry.lastIndexOf("/") + 1);
      const isCommandDir = entry.endsWith("/SKILL.md");
      if (!isCommandDir && absorbedDirs.has(holder)) return [];
      const derived = entry
        .slice(0, -".md".length)
        .split("/")
        .filter((s) => s)
        .join(":");
      return [{ dir, entry, derived, isCommandDir }];
    });
  });
  /* 文件读取互不依赖,并发读全量候选(同名跨目录候选多读一次,无观察差异);
     落表仍按 dirs×entries 原序,先到先得语义不变。 */
  const loaded = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      text: await ipc.fsReadFile(`${c.dir}/${c.entry}`).catch(() => ""),
    })),
  );
  const byValue = new Map<string, CliSuggestion>();
  for (const { derived, isCommandDir, text } of loaded) {
    if (byValue.has(derived)) continue;
    const description = text ? frontmatterDescription(text) : undefined;
    /* 命令目录的调用名 = 目录名(SKILL.md frontmatter 不改写);散装 .md 允许
       frontmatter name 覆盖派生名(claude 实证 open-spec/new.md 用法) */
    const override = isCommandDir ? "" : parseFrontmatter(text).fields.name;
    const value = override || derived;
    if (!byValue.has(value)) {
      byValue.set(value, { value, description, action: "insert", icon: "slash" });
    }
  }
  return [...byValue.values()];
}

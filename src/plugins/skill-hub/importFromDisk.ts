/**
 * 磁盘导入发现层(2026-10-18)── 本地导入视图原本只能发现「已在十家 CLI
 * 目录里」的技能,GitHub 下载的源码(zip / 克隆目录)无处进入。本层把用户
 * 任选的目录或 zip 变成导入源:
 * - 目录:fsWalkFiles 递归找 SKILL.md / skill.json,所在目录即技能(任意
 *   深度,覆盖 repo-main/skills/<name> 仓库形状);只认 SKILL.md/skill.json,
 *   README-only 目录视为文档不列(防 repo 目录噪声);dot 段防御性跳过。
 * - zip:skillExtract 解到 ~/.tmd-cli/cache/skills/import-<ts> 再走同一发现
 *   (GitHub 式单顶层目录由深发现自然消化,不需 strip_top);临时目录由
 *   视图在下次选择/卸载时清理,zip 原件永远不动。
 * 命中技能复用 ImportDialog 落位(fsCopyTree + 记档),零新落位代码。
 */
import { ipc } from "@kernel/ipc";
import { hydrateSkillMeta, metaRank, type HubSkill } from "@plugins/cli-shared/skillSources";

/** 单次发现 walk 上限(同 skillSources 扫描防呆)。 */
const WALK_CAP = 2000;

export interface DiskSkillCandidate {
  name: string;
  dir: string;
  metaFile: string;
}

/**
 * walk 相对路径 → 含 SKILL.md/skill.json 的技能目录(任意深度;纯函数,单测
 * seam)。同目录双元数据取 metaRank 高者(skill.json > SKILL.md)。
 */
export function skillDirsFromWalk(
  dir: string,
  walkEntries: readonly string[],
): DiskSkillCandidate[] {
  /* 去尾部斜杠(pickDirectory 偶带);根路径 "/" 原样。 */
  const root = dir.replace(/\/+$/, "") || dir;
  const best: Record<string, { metaFile: string; rank: number }> = {};
  for (const entry of walkEntries) {
    const segs = entry.split("/");
    if (segs.some((s) => s.startsWith("."))) continue;
    const file = segs[segs.length - 1];
    const rank = metaRank(file);
    if (rank !== 0 && rank !== 1) continue;
    const parentSegs = segs.slice(0, -1);
    const skillDir = parentSegs.length === 0 ? root : `${root}/${parentSegs.join("/")}`;
    const prev = best[skillDir];
    if (prev === undefined || rank < prev.rank) {
      best[skillDir] = { metaFile: `${root}/${entry}`, rank };
    }
  }
  return Object.entries(best)
    .map(([skillDir, { metaFile }]) => ({ name: skillDir.split("/").pop() ?? skillDir, dir: skillDir, metaFile }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toHubSkill(c: DiskSkillCandidate): HubSkill {
  /* badge/engine 仅占位:磁盘导入卡不经引擎分组渲染,落位弹窗也不读这两个字段。 */
  return { name: c.name, description: "", dir: c.dir, metaFile: c.metaFile, flat: false, badge: "user", engine: "import" };
}
/** 任选目录 → 技能清单(frontmatter 名称/描述已回填;目录不可读 = 空清单)。 */
export async function discoverDirSkills(dir: string): Promise<HubSkill[]> {
  const root = dir.replace(/\/+$/, "") || dir;
  const walk = await ipc.fsWalkFiles(root, WALK_CAP).catch(() => [] as string[]);
  const candidates = skillDirsFromWalk(root, walk);
  return Promise.all(
    candidates.map(async (c) => hydrateSkillMeta(c.metaFile, toHubSkill(c))),
  );
}

/** zip 解到应用缓存临时目录,返回该目录(后续发现/清理都基于它)。 */
export async function extractZipForImport(zipPath: string): Promise<string> {
  const dest = `${await ipc.configDir()}/cache/skills/import-${Date.now().toString(36)}`;
  await ipc.skillExtract(zipPath, dest, false);
  return dest;
}

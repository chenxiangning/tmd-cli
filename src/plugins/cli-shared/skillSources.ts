/**
 * 技能发现编排 ── 十引擎 skill 目录扫描(skill-hub 管理面与 composer 通用
 * 技能关联的共享发现层;2026-09-28 从 skill-hub/skillScan.ts 下沉,消费方:
 * skill-hub 管理面 + composer 抽屉/触发器聚合 —— cli-shared 准入先例)。
 *
 * 存储模式(上游调研定案):tmd 不做 skill 真相源,直接读各家 CLI 自己的
 * 用户级 skill 目录。目录表以提案 2026-09-28-skill-hub-plugin §4.3 为准:
 * - 每引擎只扫自家用户级目录;项目级目录随会话工作区,首版不扫;
 * - codex 另有 .system 系统技能目录,单独来源(徽标 system);
 * - `~/.agents/skills` 公约位单列一组(徽标 shared,一份多家用);
 * - 目录不存在 = 该引擎区隐藏,不猜测。
 *
 * 形态沿用 scanSkillDirs 一侧:目录式 `<name>/SKILL.md` 一层 + 平铺
 * `<name>.md`(kimi);frontmatter 解析复用 @kernel/frontmatter。本层比
 * scanSkillDirs 多交付路径与分组(管理面要预览/删除,聚合要来源引擎)。
 *
 * symlink 技能目录(Claude 官方支持)walk 不下钻:首轮 metaFile 置空,
 * resolveSkillMetaFile 用 fsListDir 惰性补齐(描述装载与预览共用)。
 */

import { ipc } from "@kernel/ipc";
import type { DirEntry } from "@kernel/ipc";
import { parseFrontmatter } from "@kernel/frontmatter";

/** 来源徽标:用户级 / codex 系统目录 / ~/.agents/skills 公约位共享。 */
export type SkillSourceBadge = "user" | "system" | "shared";

export interface HubSkill {
  /** 展示名:frontmatter name(≤64)或缺省目录名。 */
  name: string;
  /** 描述(frontmatter description,≤1024;无元数据 = 空串)。 */
  description: string;
  /** skill 目录绝对路径;平铺形 = 技能根目录(定位用,删除走 metaFile)。 */
  dir: string;
  /** 元数据文件绝对路径;首轮 walk 不可见(symlink 目录)可先空,惰性补齐。 */
  metaFile: string | null;
  /** 平铺形(kimi `<name>.md` 文件即技能):删除删文件。 */
  flat: boolean;
  badge: SkillSourceBadge;
  engine: string;
}

export interface SkillEngineGroup {
  /** 引擎 id(claude/codex/…/shared)。 */
  engine: string;
  skills: HubSkill[];
}

/** 单个扫描来源:home 相对目录 + 归属引擎 + 徽标。 */
export interface SkillDirSource {
  engine: string;
  badge: SkillSourceBadge;
  rel: string;
}

/** 引擎显示名(专有名词原样,shared 组是中文源串走词典;渲染处 t() 包裹)。 */
export const ENGINE_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  omp: "omp",
  pi: "pi",
  kimi: "Kimi Code",
  grok: "Grok",
  qoder: "Qoder",
  opencode: "OpenCode",
  dsh: "dsh",
  shared: "共享公约位",
};

/**
 * 十引擎目录表(提案 §4.3;grok 走本表直扫自家目录 —— inspect 通道只服务
 * composer 建议源,管理面要路径)。
 */
export const SKILL_SOURCES: readonly SkillDirSource[] = [
  { engine: "claude", badge: "user", rel: ".claude/skills" },
  { engine: "codex", badge: "user", rel: ".codex/skills" },
  { engine: "codex", badge: "system", rel: ".codex/skills/.system" },
  { engine: "omp", badge: "user", rel: ".omp/agent/skills" },
  { engine: "pi", badge: "user", rel: ".pi/agent/skills" },
  { engine: "kimi", badge: "user", rel: ".kimi-code/skills" },
  { engine: "grok", badge: "user", rel: ".grok/skills" },
  { engine: "qoder", badge: "user", rel: ".qoder/skills" },
  { engine: "opencode", badge: "user", rel: ".config/opencode/skills" },
  { engine: "dsh", badge: "user", rel: ".dsh/skills" },
  { engine: "shared", badge: "shared", rel: ".agents/skills" },
];

/** 安装落位目标(引擎 → home 相对目录;提案 §4.6 弹窗三选的引擎清单)。 */
export const INSTALL_ENGINES: readonly { engine: string; rel: string; readsShared: boolean }[] = [
  { engine: "claude", rel: ".claude/skills", readsShared: false },
  { engine: "codex", rel: ".codex/skills", readsShared: true },
  { engine: "omp", rel: ".omp/agent/skills", readsShared: true },
  { engine: "pi", rel: ".pi/agent/skills", readsShared: true },
  { engine: "kimi", rel: ".kimi-code/skills", readsShared: true },
  { engine: "grok", rel: ".grok/skills", readsShared: true },
  { engine: "qoder", rel: ".qoder/skills", readsShared: true },
  { engine: "opencode", rel: ".config/opencode/skills", readsShared: true },
  { engine: "dsh", rel: ".dsh/skills", readsShared: true },
];

/** 公约位 home 相对路径(安装弹窗「一份多家用」选项 + claude symlink 目标)。 */
export const SHARED_SKILLS_REL = ".agents/skills";

/** 单目录 walk 上限(异常目录防呆,同 skillDirs.ts SCAN_CAP)。 */
const WALK_CAP = 2000;
/** 元数据读取头部长度:覆盖 64 行 frontmatter 绰绰有余。 */
const META_HEAD_BYTES = 16_384;
const NAME_MAX = 64;
const DESC_MAX = 1024;

/** 元数据文件优先级(提案 §4.3:skill.json > SKILL.md(不分大小写)> README.md)。 */
export function metaRank(file: string): number {
  if (file === "skill.json") return 0;
  const lower = file.toLowerCase();
  if (lower === "skill.md") return 1;
  if (lower === "readme.md") return 2;
  return -1;
}

/**
 * 从单目录的 walk 产物 + 一层列举构建 skill 清单(纯函数,单测 seam)。
 * walk 给元数据文件路径(symlink 目录 walk 不可见 → metaFile null);
 * listing 给顶层条目集(裸目录也有卡,目录名兜底展示)。
 */
export function buildHubSkills(
  source: SkillDirSource,
  dir: string,
  walkEntries: readonly string[],
  listing: readonly Pick<DirEntry, "name" | "isDir">[],
): HubSkill[] {
  const meta = new Map<string, string>();
  for (const entry of walkEntries) {
    const seg = entry.split("/");
    if (seg.length !== 2 || seg[0].startsWith(".")) continue;
    const rank = metaRank(seg[1]);
    if (rank < 0) continue;
    const prev = meta.get(seg[0]);
    if (prev === undefined || rank < metaRank(prev.split("/").pop() ?? "")) {
      meta.set(seg[0], `${dir}/${entry}`);
    }
  }
  const out: HubSkill[] = [];
  for (const e of listing) {
    if (e.name.startsWith(".") || e.name === "SKILL.md") continue;
    if (e.isDir) {
      out.push({
        name: e.name,
        description: "",
        dir: `${dir}/${e.name}`,
        metaFile: meta.get(e.name) ?? null,
        flat: false,
        badge: source.badge,
        engine: source.engine,
      });
    } else if (e.name.endsWith(".md")) {
      /* kimi 平铺形:文件即技能。 */
      out.push({
        name: e.name.replace(/\.md$/, ""),
        description: "",
        dir,
        metaFile: `${dir}/${e.name}`,
        flat: true,
        badge: source.badge,
        engine: source.engine,
      });
    }
  }
  return out;
}

/** 元数据文件定位:已有直接用;walk 不可见(symlink 目录)fsListDir 惰性探测。 */
export async function resolveSkillMetaFile(skill: HubSkill): Promise<string | null> {
  if (skill.metaFile || skill.flat) return skill.metaFile;
  const listing = await ipc.fsListDir(skill.dir).catch(() => null);
  if (!listing) return null;
  let best: string | null = null;
  let bestRank = 3;
  for (const e of listing) {
    const rank = metaRank(e.name);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = `${skill.dir}/${e.name}`;
    }
  }
  return best;
}

/** 读元数据头部并回填展示名/描述(skill.json 走 JSON 字段,markdown 走 frontmatter)。 */
export async function hydrateSkillMeta(metaFile: string, skill: HubSkill): Promise<HubSkill> {
  const text = await ipc.fsReadHead(metaFile, META_HEAD_BYTES).catch(() => "");
  if (!text) return skill;
  let name = "";
  let description = "";
  if (metaFile.endsWith(".json")) {
    try {
      const json = JSON.parse(text) as { name?: unknown; description?: unknown };
      name = typeof json.name === "string" ? json.name.trim() : "";
      description = typeof json.description === "string" ? json.description.trim() : "";
    } catch {
      /* 损坏 json:目录名兜底,与无元数据同语义 */
    }
  } else {
    const { fields, firstBodyLine } = parseFrontmatter(text);
    name = (fields.name ?? "").trim();
    description = fields.description?.trim() || firstBodyLine;
  }
  return {
    ...skill,
    name: (name || skill.name).slice(0, NAME_MAX),
    description: description.slice(0, DESC_MAX),
  };
}

/** 扫描全部来源并按引擎分组合并(codex 双来源同组);缺目录/空组跳过。 */
export async function scanAllSkillSources(home: string): Promise<SkillEngineGroup[]> {
  const groups = new Map<string, HubSkill[]>();
  await Promise.all(
    SKILL_SOURCES.map(async (source) => {
      const dir = `${home}/${source.rel}`;
      const listing = await ipc.fsListDir(dir).catch(() => null);
      if (!listing) return; // 目录不存在 = 引擎区隐藏
      const walkEntries = await ipc.fsWalkFiles(dir, WALK_CAP).catch(() => [] as string[]);
      const hydrated = await Promise.all(
        buildHubSkills(source, dir, walkEntries, listing).map(async (skill) => {
          const metaFile = await resolveSkillMetaFile(skill);
          return metaFile ? hydrateSkillMeta(metaFile, skill) : skill;
        }),
      );
      if (hydrated.length === 0) return;
      const bucket = groups.get(source.engine) ?? [];
      bucket.push(...hydrated);
      groups.set(source.engine, bucket);
    }),
  );
  return [...groups.entries()].map(([engine, skills]) => ({ engine, skills }));
}

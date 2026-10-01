/**
 * 技能安装记录(tmd-cli 自有关联层)── composer 与 skill-hub 双消费,准入先例。
 * spec:docs/superpowers/specs/2026-09-28-composer-universal-skills-design.md(v2)
 *
 * 记录 ≠ 内容真相源:skill 真身在各 CLI 目录/公约位(tmd 不搬内容语义),
 * 记录只存「谁被 tmd 装过/导入过、落在哪」——「已安装」边界与 composer
 * 级联的唯一依据。磁盘文件 ~/.tmd-cli/installed-skills.json。
 */
import { ipc } from "@kernel/ipc";
import { createSubscribable } from "@kernel/subscribable";
import type { CliSuggestion } from "@kernel/cli";
import { INSTALL_ENGINES, SHARED_SKILLS_REL } from "./skillSources";

export interface InstalledSkillRecord {
  /** 技能名(= 目录名,frontmatter name 可能不同但 CLI 按目录识别)。 */
  name: string;
  description?: string;
  source: "store" | "import";
  /** 落位目标(home 相对目录,如 ".agents/skills" 或 ".claude/skills")。 */
  targets: string[];
  /** 安装时的商店版本(ClawHub latestVersion;导入/旧记录缺省 = 不参与更新比对)。 */
  version?: string;
  createdAt: number;
}

interface RegistryState {
  records: InstalledSkillRecord[];
  loaded: boolean;
}

const store = createSubscribable<RegistryState>({ records: [], loaded: false });
let inFlight = false;

export function useSkillRegistry(): RegistryState {
  return store.useStore();
}

/** 非组件快照读取(composer 数据层轮询用)。 */
export function skillRegistrySnapshot(): RegistryState {
  return store.snapshot;
}

function registryPath(): Promise<string> {
  return ipc.configDir().then((dir) => `${dir}/installed-skills.json`);
}

/** 全量加载(幂等;文件缺失/损坏 = 空表起步,不拖垮)。 */
export async function loadSkillRegistry(force = false): Promise<void> {
  if (inFlight) return;
  if (store.snapshot.loaded && !force) return;
  inFlight = true;
  try {
    try {
      await loadFromDisk();
    } catch {
      store.commit({ records: [], loaded: true }); /* 环境 ipc 缺失/异常 = 空表起步 */
    }
    return;
  } finally {
    inFlight = false;
  }
}

async function loadFromDisk(): Promise<void> {
  /* configDir 不可用(测试桩/极端环境)= 空表起步,不拖垮消费方 */
  const path = await registryPath().catch(() => null);
  if (path === null) {
    store.commit({ records: [], loaded: true });
    return;
  }
  const text = await ipc.fsReadFile(path).catch(() => "");
  let records: InstalledSkillRecord[] = [];
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        records = parsed.filter(
          (r): r is InstalledSkillRecord =>
            !!r && typeof (r as InstalledSkillRecord).name === "string" &&
            Array.isArray((r as InstalledSkillRecord).targets),
        );
      }
    } catch {
      /* 损坏 json:空表起步(首存即修复) */
    }
  }
  store.commit({ records, loaded: true });
}

async function save(records: InstalledSkillRecord[]): Promise<void> {
  const path = await registryPath();
  await ipc.fsWriteFile(path, JSON.stringify(records, null, 2));
  store.commit({ records, loaded: true });
}

/** 新增/覆盖一条安装记录(同名 = 更新落位与来源)。 */
export async function upsertSkillRecord(rec: InstalledSkillRecord): Promise<void> {
  const records = store.snapshot.records.filter((r) => r.name !== rec.name);
  records.push(rec);
  await save(records);
}

/** 删除记录(仅记录;落位目录清理由调用方决定,删除视图带二次确认)。 */
export async function removeSkillRecord(name: string): Promise<void> {
  await save(store.snapshot.records.filter((r) => r.name !== name));
}

/** 引擎 → home 相对技能目录(INSTALL_ENGINES 透传,claude 含 symlink 语义)。 */
function engineSkillRel(engine: string): string | null {
  return INSTALL_ENGINES.find((e) => e.engine === engine)?.rel ?? null;
}

/**
 * 记录在当前 profile 的可用性:任一 target 命中该引擎目录,或公约位且该引擎
 * 原生读(claude 不读公约位,须 target 含 .claude/skills 即 symlink 落位)。
 */
export function recordUsableByProfile(rec: InstalledSkillRecord, profileId: string): boolean {
  const ownRel = engineSkillRel(profileId);
  return rec.targets.some((t) => {
    if (ownRel && t === ownRel) return true;
    return t === SHARED_SKILLS_REL && (profileId === "claude" ? false : engineReadsSharedSafe(profileId));
  });
}

function engineReadsSharedSafe(engine: string): boolean {
  return INSTALL_ENGINES.find((e) => e.engine === engine)?.readsShared ?? false;
}

/** composer skill 候选 = 记录 ∩ 当前 profile 可用(级联闭环,无目录扫描)。 */
export function installedSkillSuggestions(
  profileId: string,
  records: readonly InstalledSkillRecord[],
): CliSuggestion[] {
  return records
    .filter((r) => recordUsableByProfile(r, profileId))
    .map((r) => ({
      value: r.name,
      description: r.description || undefined,
      action: "insert" as const,
      icon: "think",
    }));
}

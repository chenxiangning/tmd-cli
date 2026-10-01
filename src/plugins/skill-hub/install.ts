/**
 * 安装编排 ── 冲突探测 → netDownload → 逐目标 skillExtract → 缓存清理。
 *
 * 落位语义(提案 §4.6):目标引擎多选(各装一份进自家目录)+ 公约位
 * `~/.agents/skills`(一份多家用)+ claude 补链勾选(skillSymlink,失败
 * 降级提示不阻断)。skill 目录名 = 卡片 slug(包内容解进 <slug>/,zip 单
 * 顶层目录被剥离;平铺包原样落位)。失败时已落位目标保留不回滚,结果如实
 * 列出;缓存 zip 安装后即删。
 */

import { ipc } from "@kernel/ipc";
import { upsertSkillRecord } from "@plugins/cli-shared/skillRegistry";
import { INSTALL_ENGINES, SHARED_SKILLS_REL } from "./skillScan";
import { resolveClawHubOwner } from "./clawhub";
import type { ClawHubCard } from "./clawhubNormalize";

export interface InstallTargetSpec {
  /** 选中的引擎 id 集(INSTALL_ENGINES 子集,默认 claude)。 */
  engines: readonly string[];
  /** 落公约位 ~/.agents/skills(一份多家用)。 */
  shared: boolean;
  /** claude 补 symlink(公约位内容的 claude 可见性;仅 shared 有意义)。 */
  claudeSymlink: boolean;
}

export interface InstallTarget {
  /** 落位目录(引擎 skills 目录或公约位)。 */
  dir: string;
  label: string;
}

/** 落位目录清单(引擎选择 + 公约位)。 */
export async function installTargets(home: string, spec: InstallTargetSpec): Promise<InstallTarget[]> {
  const out: InstallTarget[] = [];
  for (const e of INSTALL_ENGINES) {
    if (spec.engines.includes(e.engine)) out.push({ dir: `${home}/${e.rel}`, label: e.engine });
  }
  if (spec.shared) out.push({ dir: `${home}/${SHARED_SKILLS_REL}`, label: "shared" });
  return out;
}

export interface InstallConflict {
  target: InstallTarget;
  /** 撞名的既有条目名(目录或平铺 .md)。 */
  name: string;
}

/** 逐落位目标探测同名冲突(目录不存在 = 无冲突,安装时创建)。 */
export async function probeInstallConflicts(
  home: string,
  slug: string,
  spec: InstallTargetSpec,
): Promise<InstallConflict[]> {
  const targets = await installTargets(home, spec);
  const probe = targets.map(async (target) => {
    const listing = await ipc.fsListDir(target.dir).catch(() => null);
    if (!listing) return null;
    const hit = listing.find((e) => e.name === slug || e.name === `${slug}.md`);
    return hit ? { target, name: hit.name } : null;
  });
  return (await Promise.all(probe)).filter((c): c is InstallConflict => c !== null);
}

export type TargetOutcome = {
  target: InstallTarget;
  state: "done" | "skipped" | "failed";
  error?: string;
};

export interface InstallOutcome {
  stage: "download" | "extract" | "done" | "error";
  targets: TargetOutcome[];
  /** claude 补链失败提示(不阻断,降级展示)。 */
  symlinkNote: string | null;
  error: string | null;
}

/**
 * 执行安装。resolutions = 撞名目标的用户裁决(overwrite = trash 旧目录;
 * 缺省项视为 skip)。onStage 每阶段翻转回调(弹窗阶段态渲染)。
 */
export async function runInstall(
  card: ClawHubCard,
  spec: InstallTargetSpec,
  resolutions: ReadonlyMap<string, "overwrite">,
  onStage: (stage: InstallOutcome["stage"]) => void,
): Promise<InstallOutcome> {
  const outcome: InstallOutcome = { stage: "download", targets: [], symlinkNote: null, error: null };
  try {
    const resolved = await resolveClawHubOwner(card);
    const home = await ipc.configHomeDir();
    const targets = await installTargets(home, spec);
    const cacheDir = `${await ipc.configDir()}/cache/skills`;
    onStage("download");
    const dl = await ipc.netDownload(resolved.downloadUrl, cacheDir);
    onStage("extract");
    /* eslint-disable react-doctor/async-await-in-loop -- 逐目标串行安装是提案选定形态
       (阶段态逐目标翻转;方案取舍明确否决了 Rust 后台 job + 轮询)。 */
    for (const target of targets) {
      try {
        const dest = `${target.dir}/${resolved.slug}`;
        const conflict = await ipc.fsListDir(target.dir).catch(() => null);
        const hit = conflict?.find((e) => e.name === resolved.slug || e.name === `${resolved.slug}.md`);
        if (hit) {
          if (resolutions.get(target.dir) !== "overwrite") {
            outcome.targets.push({ target, state: "skipped" });
            continue;
          }
          await ipc.fsTrashEntry(`${target.dir}/${hit.name}`);
        }
        await ipc.skillExtract(dl.path, dest, true);
        outcome.targets.push({ target, state: "done" });
      } catch (e) {
        outcome.targets.push({ target, state: "failed", error: String(e) });
      }
    }
    /* eslint-enable react-doctor/async-await-in-loop */
    /* claude 已在直装目标里时,链接位被真目录占用,补链必败且无意义 → 跳过。 */
    const claudeDirect = targets.some((t) => t.dir.endsWith(".claude/skills"));
    let claudeLinked = false;
    if (spec.shared && spec.claudeSymlink && !claudeDirect) {
      try {
        await ipc.skillSymlink(
          `${home}/${SHARED_SKILLS_REL}/${resolved.slug}`,
          `${home}/.claude/skills/${resolved.slug}`,
        );
        claudeLinked = true;
      } catch (e) {
        outcome.symlinkNote = String(e);
      }
    }
    await ipc.fsRemovePath(dl.path).catch(() => undefined);
    /* v2 闭环:落位成功(≥1 目标 done)即写安装记录(composer 级联依据)。
       targets 记 home 相对路径;claude 补链成功也计入(该 skill claude 可用);
       version 记卡片 latestVersion(更新闭环比对依据,缺 = 如实不显更新)。 */
    const doneTargets = outcome.targets.filter((r) => r.state === "done");
    if (doneTargets.length > 0) {
      const rels = doneTargets.map((r) => r.target.dir.replace(`${home}/`, ""));
      if (claudeLinked) rels.push(".claude/skills");
      await upsertSkillRecord({
        name: resolved.slug,
        source: "store",
        description: card.summary || undefined,
        targets: rels,
        version: resolved.latestVersion || undefined,
        createdAt: Date.now(),
      }).catch(() => undefined); /* 记录失败不阻断安装(真身已落盘) */
    }
    outcome.stage = "done";
    onStage("done");
  } catch (e) {
    outcome.error = e instanceof Error ? e.message : String(e);
    outcome.stage = "error";
    onStage("error");
  }
  return outcome;
}

/**
 * 记忆文件面板 · 数据面 —— 声明展开、三态归并、批量探测、空模板生成(自面板拆出守 300 行铁则)。
 *
 * 数据 = 全部已注册 profile × CliProfile.memoryFiles 声明(声明式,内核零路径知识);
 * 探测用 fsReadHeads(1 字节,单文件失败 Rust 侧回空串 = 未生成,批量 IPC 失败全降级,
 * 不抛)—— 仓库无 stat 原语,存在性判定选了最便宜的一跳 IPC。
 */

import { ipc } from "@kernel/ipc";
import { ensureParentDir } from "@kernel/fsDirs";
import type { CliProfile } from "@kernel/cli";

/** 声明槽(profile.memoryFiles 条目展开成绝对路径后的面)。 */
export interface MemorySlot {
  /** 引擎 id(CliProfile.id,行首列展示)。 */
  engine: string;
  scope: "project" | "user";
  /** 文件名(声明携带,mono 主列)。 */
  label: string;
  relPath: string;
  /** 绝对路径:project = cwd 相对拼接 / user = home 相对拼接。 */
  absPath: string;
}

/** 三态:在 / 未生成 / 未声明(探测失败一律按未生成降级,不抛)。 */
export type MemoryFileState = "ok" | "missing" | "undeclared";

/** 探测结果:绝对路径 → 是否存在。 */
export type MemoryProbeMap = Record<string, boolean>;

/** 声明展开的最小 profile 面(host.getCliProfiles 的子集,纯函数单测 seam)。 */
export type MemoryProfileSource = readonly {
  id: string;
  memoryFiles?: CliProfile["memoryFiles"];
}[];

/**
 * 声明展开:profiles × memoryFiles → 项目级/用户级两组槽。
 * cwd 为 null(未开工作区)= 项目级整组为空(调用方整组隐藏);
 * 未声明 memoryFiles 的 profile 不产生槽(未声明分组走 undeclaredEngines)。
 * 拼接用 posix 相对拼接(paths.ts 同款简单拼接先例)。
 */
export function expandMemorySlots(
  profiles: MemoryProfileSource,
  cwd: string | null,
  home: string,
): { project: MemorySlot[]; user: MemorySlot[] } {
  const project: MemorySlot[] = [];
  const user: MemorySlot[] = [];
  for (const p of profiles) {
    for (const decl of p.memoryFiles ?? []) {
      if (decl.scope === "project" && cwd === null) continue; /* 项目级槽无 cwd = 不展开(整组隐藏语义) */
      const absPath = decl.scope === "project" ? `${cwd}/${decl.relPath}` : `${home}/${decl.relPath}`;
      const slot: MemorySlot = {
        engine: p.id,
        scope: decl.scope,
        label: decl.label,
        relPath: decl.relPath,
        absPath,
      };
      (decl.scope === "project" ? project : user).push(slot);
    }
  }
  return { project, user };
}

/** 未声明分组:零声明 profile 的引擎 id(保持注册序,面板灰组数据)。 */
export function undeclaredEngines(profiles: MemoryProfileSource): string[] {
  return profiles.filter((p) => !p.memoryFiles || p.memoryFiles.length === 0).map((p) => p.id);
}

/** 单槽三态归并:探测命中 = 在,否则未生成(探测失败已降级为 false)。 */
export function slotState(slot: MemorySlot, probe: MemoryProbeMap): "ok" | "missing" {
  return probe[slot.absPath] ? "ok" : "missing";
}

/** 空文件模板:仅一行标题空壳,内容留给用户或 CLI /init 填充。 */
export function memoryTemplate(slot: MemorySlot): string {
  return `# ${slot.label}\n`;
}

/**
 * 生成空模板:先逐级确保父目录(已存在报错被 ensureDir 吞),再覆写写盘。
 * 覆写语义安全:生成钮只出现在探测未命中的行,已存在文件永远不走此路径。
 */
export async function generateMemoryTemplate(slot: MemorySlot): Promise<void> {
  await ensureParentDir(slot.absPath);
  await ipc.fsWriteFile(slot.absPath, memoryTemplate(slot));
}

/**
 * 批量探测:fsReadHeads 读头 1 字节 —— 存在 = 头部非空。一次 IPC 探全部槽;
 * 单文件失败 Rust 侧已回空串(下标对齐契约),整体 IPC 失败 = 全部按未生成。
 */
export async function probeMemoryFiles(paths: readonly string[]): Promise<MemoryProbeMap> {
  if (paths.length === 0) return {};
  try {
    const heads = await ipc.fsReadHeads([...paths], 1);
    const out: MemoryProbeMap = {};
    paths.forEach((p, i) => {
      out[p] = (heads[i] ?? "").length > 0;
    });
    return out;
  } catch {
    return Object.fromEntries(paths.map((p) => [p, false]));
  }
}

/** 摘要计数:全部槽 + 未声明引擎数 → 「N 在 · M 缺 · K 未声明」。 */
export function summarizeMemoryFiles(
  project: readonly MemorySlot[],
  user: readonly MemorySlot[],
  probe: MemoryProbeMap,
  undeclaredCount: number,
): { ok: number; missing: number; undeclared: number } {
  let ok = 0;
  let missing = 0;
  for (const slot of [...project, ...user]) {
    if (slotState(slot, probe) === "ok") ok += 1;
    else missing += 1;
  }
  return { ok, missing, undeclared: undeclaredCount };
}

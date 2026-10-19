/**
 * 转录导出落盘内核(0.4.0 候选14;node 可测,选目录/toast 等 UI 面在消费方插件):
 * - exportMdTo = 定位磁盘会话 → readSessionTranscript → blocksToMarkdown →
 *   文件名防撞(sessionExportFileName;同批 taken 命中或盘上已存在 → -2 递增)
 *   → writeText 原子写(后端 tmp+rename;父目录由 ensureParentDir 兜底自建)。
 * - snapshotMdTo = 同链,但落 pickSavePath 选定的完整路径(单文件另存交互,
 *   与 viewerTab 工具行导出同语义)。
 * 全程不抛,失败归一 reason:no-adapter = 引擎未声明转录适配器(不猜纪律);
 * unreadable = 定位失败/读取失败(ssh 远程源沿 piFamily v1 口径按 null 降级);
 * write-failed = 落盘失败。UI 按 reason 出「无适配器/不可读/写入失败」文案。
 */
import { ipc } from "@kernel/ipc";
import { host } from "@kernel/host";
import { t } from "@kernel/i18n";
import type { CliDiskSession, CliProfile } from "@kernel/cli";
import {
  blocksToMarkdown,
  sessionExportFileName,
  type MarkdownExport,
} from "./blocksToMarkdown";
import { writeText } from "@plugins/workbench/docgen/paths";

export type ExportMdReason = "no-adapter" | "unreadable" | "write-failed";

/** 失败原因 → 文案(批量失败列表、快照失败 toast 共用一套口径;键在 workspace 词典)。 */
export function exportReasonLabel(reason: ExportMdReason): string {
  return reason === "no-adapter" ? t("无适配器") : reason === "unreadable" ? t("不可读") : t("写入失败");
}

export type ExportMdResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: ExportMdReason };

export type SnapshotMdResult =
  | { ok: true; exportedAt: number; out: MarkdownExport }
  | { ok: false; reason: ExportMdReason };

/** 导出目标:磁盘会话直给 path;活会话给 cwd 走 listSessions 兜底定位(同 viewerTab)。 */
export interface ExportSessionTarget {
  cliSessionId: string;
  title?: string;
  profileId: string;
  path?: string;
  modifiedAt?: number;
  cwd?: string;
}

/** 定位可读的磁盘会话:有 path 直接拼装;否则扫 cwd 找同 id(一次性,无轮询)。 */
export async function resolveExportSession(
  profile: CliProfile,
  target: ExportSessionTarget,
): Promise<CliDiskSession | null> {
  if (target.path) {
    return {
      id: target.cliSessionId,
      title: target.title,
      modifiedAt: target.modifiedAt ?? Date.now(),
      path: target.path,
    };
  }
  if (!target.cwd || !profile.listSessions) return null;
  const sessions = await profile.listSessions(target.cwd).catch(() => null);
  return sessions?.find((s) => s.id === target.cliSessionId) ?? null;
}

/** 读转录并渲染 markdown;适配器缺失/定位失败/读取失败归一 reason,不抛。 */
async function buildMarkdown(
  target: ExportSessionTarget,
  exportedAt?: number,
): Promise<{ ok: true; out: MarkdownExport } | { ok: false; reason: ExportMdReason }> {
  const profile = host.getCliProfile(target.profileId);
  const reader = profile?.readSessionTranscript;
  if (!reader) return { ok: false, reason: "no-adapter" };
  const disk = await resolveExportSession(profile, target);
  if (!disk) return { ok: false, reason: "unreadable" };
  const transcript = await reader(disk).catch(() => null);
  if (!transcript) return { ok: false, reason: "unreadable" };
  return {
    ok: true,
    out: blocksToMarkdown(transcript, {
      title: target.title,
      cliSessionId: target.cliSessionId,
      profileId: target.profileId,
      exportedAt,
    }),
  };
}

/** 盘上占用探测:读头 1 字节,读不到即视为不存在(读全文件浪费)。 */
function probeExists(path: string): Promise<boolean> {
  return ipc.fsReadHead(path, 1).then(
    () => true,
    () => false,
  );
}

/** 目录内防撞命名:同批 taken 命中或盘上已存在 → 基名追加 -2、-3… 递增,不预编号。 */
export async function dedupeExportName(
  dir: string,
  target: ExportSessionTarget,
  taken?: Set<string>,
): Promise<string> {
  const base = sessionExportFileName(target.title, target.cliSessionId);
  let name = base;
  for (let n = 2; (taken?.has(name) ?? false) || (await probeExists(`${dir}/${name}`)); n++) {
    name = base.replace(/\.md$/, `-${n}.md`);
  }
  taken?.add(name);
  return name;
}

/** 批量内核:落 `<dir>/<防撞文件名>`,返回最终文件名;不抛。 */
export async function exportMdTo(
  dir: string,
  target: ExportSessionTarget,
  taken?: Set<string>,
): Promise<ExportMdResult> {
  const built = await buildMarkdown(target);
  if (!built.ok) return built;
  const name = await dedupeExportName(dir, target, taken);
  try {
    await writeText(`${dir}/${name}`, built.out.markdown);
  } catch {
    return { ok: false, reason: "write-failed" };
  }
  return { ok: true, fileName: name };
}

/** 单文件快照:落指定完整路径,返回导出时点(ms)供 toast 注明「快照时点」;不抛。 */
export async function snapshotMdTo(
  path: string,
  target: ExportSessionTarget,
): Promise<SnapshotMdResult> {
  const at = Date.now();
  const built = await buildMarkdown(target, at);
  if (!built.ok) return built;
  try {
    await writeText(path, built.out.markdown);
  } catch {
    return { ok: false, reason: "write-failed" };
  }
  return { ok: true, exportedAt: at, out: built.out };
}

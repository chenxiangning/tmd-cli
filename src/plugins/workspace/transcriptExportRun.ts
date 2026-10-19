/**
 * 转录导出落盘管线 —— 自 transcriptExport.tsx 迁出(组件文件只留组件,
 * Fast Refresh 才能安全保态)。落盘内核在 @plugins/session-viewer/exportMd
 * (readSessionTranscript → blocksToMarkdown → writeText 原子写),本件只管
 * 帽 50 拒开跑、串行循环、失败文案归类与菜单 prop 装配。
 * 串行循环同 tabClose 逐个过闸(doctor 豁免 async-await-in-loop):有意 await
 * 于循环内 —— 进度语义清晰,可取消,且避免并发写盘压爆目标目录。
 */
import {
  exportMdTo,
  type ExportMdReason,
  type ExportSessionTarget,
} from "@plugins/session-viewer/exportMd";
import { type SessionMeta } from "@kernel/ipc";

/** 单批导出帽:超限拒开跑(设计定稿:提示分批,不截断)。 */
export const BATCH_EXPORT_CAP = 50;

/** 批量导出条目:label 供失败列表展示,target 喂落盘内核。 */
export interface BatchExportItem {
  key: string;
  label: string;
  target: ExportSessionTarget;
}

export interface BatchExportOutcome {
  written: number;
  cancelled: boolean;
  /** write-failed 中止点(该会话 label;设计红线:磁盘满/权限拒绝整批中止,已写留存)。 */
  aborted: string | null;
  failures: Array<{ label: string; reason: Exclude<ExportMdReason, "write-failed"> }>;
}

/** 帽闸:超限返回 blocked(不开跑),未超限原样放行。 */
export function planBatchExport(
  items: BatchExportItem[],
): { items: BatchExportItem[] } | { blocked: "over-cap"; count: number } {
  return items.length > BATCH_EXPORT_CAP ? { blocked: "over-cap", count: items.length } : { items };
}

/** 串行批量导出;write-failed 即中止(磁盘满/权限类不可恢复,剩余未导),no-adapter/
 *  unreadable 跳过续跑;isCancelled 每项前查询,命中即停在当前(已完成留存,不回滚)。 */
export async function exportSessionsBatch(
  items: BatchExportItem[],
  dir: string,
  opts: { isCancelled(): boolean; onProgress(done: number, total: number): void },
): Promise<BatchExportOutcome> {
  const taken = new Set<string>();
  const failures: BatchExportOutcome["failures"] = [];
  let written = 0;
  let cancelled = false;
  let aborted: string | null = null;
  opts.onProgress(0, items.length);
  for (let i = 0; i < items.length; i++) {
    if (opts.isCancelled()) {
      cancelled = true;
      break;
    }
    const r = await exportMdTo(dir, items[i].target, taken);
    if (r.ok) written++;
    else if (r.reason === "write-failed") {
      aborted = items[i].label;
      opts.onProgress(i + 1, items.length);
      break;
    } else failures.push({ label: items[i].label, reason: r.reason });
    opts.onProgress(i + 1, items.length);
  }
  return { written, cancelled, aborted, failures };
}

/** 菜单 prop 装配:无磁盘绑定或 ssh/shell 会话回 undefined(项隐藏);否则绑 run。 */
export function snapshotMenuHandler(
  run: (t: ExportSessionTarget) => void,
  session: SessionMeta,
  cliSessionId: string | undefined,
  title: string,
  profileId: string,
  cwd: string,
): (() => void) | undefined {
  if (cliSessionId === undefined || session.kind === "ssh" || session.kind === "shell") {
    return undefined;
  }
  const target: ExportSessionTarget = { cliSessionId, title, profileId, cwd };
  return () => run(target);
}

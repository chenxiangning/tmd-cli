/**
 * BatchRow 拆件 —— 自 BatchRow.tsx 拆出(文件规模铁则)。
 *
 * 文件行(状态 chip + 路径 + ± + 深链审阅单 + hover 打开文件/定位 + hover 单文件回退)。
 * 内联确认卡(含恢复 dry-run 预览表)与 ConfirmTarget 拆至 confirmCard.tsx
 * (042 项6),此处 re-export 维持既有导入契约。
 */

import { ArrowCounterClockwise, FileText, FolderOpen } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { DecorIcon } from "@kernel/iconSet";
import { ipc, type CkptBatch, type CkptBatchFile } from "@kernel/ipc";
import { openFileInTab } from "@kernel/fileTabs";
import { getCachedDiff } from "./diffCache";
import { classifyRisk } from "./risk";
import { openBatchTab } from "./batchTab";
import { fileChipCls } from "./fileChipCls";
import type { ConfirmTarget } from "./confirmCard";

export { ConfirmCard } from "./confirmCard";
export type { ConfirmTarget } from "./confirmCard";

export function FileRow({
  file: f,
  batch: b,
  cwd,
  sessionId,
  tmdSessionId,
  busy,
  setConfirm,
}: {
  file: CkptBatchFile;
  batch: CkptBatch;
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
  busy: boolean;
  setConfirm: (v: ConfirmTarget | null) => void;
}) {
  const canRevert = b.state === "pending" && f.live === "same" && !f.noBaseline;
  /* hover 入口图标用:工作区外文件(无前像标记的外部路径)本身是绝对路径,原样打开 */
  const abs = f.path.startsWith("/") ? f.path : `${cwd.replace(/[\\/]+$/, "")}/${f.path}`;
  const segs = f.path.split("/");
  const name = segs.pop() ?? f.path;
  const dir = segs.length ? segs.join("/") + "/" : "";
  const patches = getCachedDiff(cwd, sessionId, b.id);
  const mine = patches?.find((p) => p.path === f.path);
  return (
    <div className="group flex h-[25px] items-center gap-1.5 rounded px-1.5 hover:bg-(--tmd-bg-hover)">
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        title={t("点击在编辑区查看该文件 diff")}
        onClick={() =>
          openBatchTab({
            cwd,
            sessionId,
            tmdSessionId,
            batchId: b.id,
            title: t("批次 #{index}", { index: b.index }),
            focusPath: f.path,
          })
        }
      >
        <span
          className={`grid h-[14px] w-[14px] flex-none place-items-center rounded text-meta font-bold ${fileChipCls(f.status)}`}
        >
          {f.status}
        </span>
        {classifyRisk(f.path) === "high" && (
          /* 高危红标右栏缺位是 P0-3:整批「通过」按钮在此面,无标即盲放。
             徽标与中央批审阅单(BatchFileSection)同款同源,risk.ts 唯一规则源。 */
          <span
            className="flex-none rounded bg-(--tmd-diff-removed)/15 px-1 text-meta font-bold text-(--tmd-diff-removed)"
            title={t("敏感路径(凭据/Shell 配置/CI/服务),建议细读 diff 再放行")}
          >
            {t("高危")}
          </span>
        )}
        {f.editCount > 0 && b.attribution === "events" && (
          <span
            className="flex-none rounded border border-(--tmd-border) px-1 text-2xs leading-3 text-(--tmd-fg-faint)"
            title={t("AI 本轮写入该文件 {n} 次(事件流轨迹,账本可审计)", { n: f.editCount })}
          >
            ×{f.editCount}
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-(--tmd-fg-muted)"
          title={f.path}
        >
          <b className="font-medium text-(--tmd-fg)">{name}</b>{" "}
          <span className="text-(--tmd-fg-faint)">{dir}</span>
        </span>
        {mine && (
          <span className="flex-none font-mono text-meta">
            <span className="text-(--tmd-diff-inserted)">+{mine.additions}</span>{" "}
            <span className="text-(--tmd-diff-removed)">−{mine.deletions}</span>
          </span>
        )}
        {f.reverted && (
          <span className="flex-none rounded border border-dashed border-[#a78bfa] px-1 text-meta leading-3.5 text-[#a78bfa]">
            {t("已退")}
          </span>
        )}
        {f.stale && (
          <span
            className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-meta leading-3.5 text-(--tmd-fg-faint)"
            title={t("工作区内容已偏离本批后像,不可回退,仅可对照")}
          >
            {t("内容已变")}
          </span>
        )}
        {f.noBaseline && (
          <span
            className="flex-none rounded border border-dashed border-(--tmd-fg-faint) px-1 text-meta leading-3.5 text-(--tmd-fg-faint)"
            title={t("工作区外文件,首轮批前像不可知 —— 禁回退(防误删既有文件);次轮起可正常回退")}
          >
            {t("无前像")}
          </span>
        )}
      </button>
      {/* 打开文件 / 打开文件位置:与 git 面板 FileOpenActions 同款(hover 出现);D 已从盘上消失不渲染 */}
      {f.status !== "D" && (
        <>
          <button
            type="button"
            data-action-id="git-open"
            className="hidden h-[19px] w-[19px] flex-none place-items-center rounded group-hover:grid hover:bg-(--tmd-bg-hover)"
            title={t("打开文件")}
            onClick={() => openFileInTab(abs)}
          >
            <DecorIcon id="git-open" Fallback={FileText} className="h-[0.6875rem] w-[0.6875rem]" />
          </button>
          <button
            type="button"
            data-action-id="git-open-location"
            className="hidden h-[19px] w-[19px] flex-none place-items-center rounded group-hover:grid hover:bg-(--tmd-bg-hover)"
            title={t("打开文件位置")}
            onClick={() => void ipc.fsRevealInFileManager(abs).catch((err) => console.warn("[reveal] 打开文件位置失败:", err))}
          >
            <DecorIcon id="git-open-location" Fallback={FolderOpen} className="h-[0.6875rem] w-[0.6875rem]" />
          </button>
        </>
      )}
      {canRevert && (
        <button
          type="button"
          disabled={busy}
          className="hidden h-[19px] w-[19px] flex-none place-items-center rounded text-(--tmd-fg-subtle) group-hover:grid hover:bg-[#a78bfa]/15 hover:text-[#a78bfa] disabled:opacity-40"
          title={t("只回退这个文件")}
          onClick={() => setConfirm({ batchId: b.id, paths: [f.path] })}
        >
          <ArrowCounterClockwise size="0.6875rem" aria-hidden />
        </button>
      )}
    </div>
  );
}

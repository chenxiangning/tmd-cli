/**
 * 体检运行态 · 中央处理视图(规则细项 + loading 进度)。
 * 运行中接管 LintReportTab 中央区:进度条 + 按文件分组的规则行
 * (已提取·待测 / 识别中 / 判定中 / 已判定徽章)+ 右侧当前批次脚本测量摘要;
 * 结束后切回 ReportBody(报告页),本视图不再渲染。
 */

import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import type { LintProgress, LintRunResult } from "./lintModel";
import { VERDICT_LABEL, type LintRow, type LintVerdict } from "./lintTypes";

const VERDICT_CLS: Record<LintVerdict, string> = {
  working: "bg-(--tmd-ok)/10 text-(--tmd-ok)",
  violated: "bg-(--tmd-error)/10 text-(--tmd-error)",
  touched: "bg-(--tmd-accent)/10 text-(--tmd-accent)",
  dormant: "bg-(--tmd-warn)/10 text-(--tmd-warn)",
  unverifiable: "bg-(--tmd-bg-subtle) text-(--tmd-fg-muted)",
};

/** 步进 → 总进度百分比(脚本 45 / 判定 45–95 / 完成 100)。 */
function percentOf(p: LintProgress | null): number {
  const step = p?.step;
  if (!step || step === "targets") return 6;
  if (step === "corpus") return 18;
  if (step === "evidence") return 30;
  if (step === "recognize") return 45;
  if (step === "judge") return 45 + Math.round(((p.done ?? 0) / Math.max(p.total ?? 1, 1)) * 50);
  return 100;
}

/** 行状态徽章:已判定(色) / 判定中(spinner) / 待判定(已识别) / 识别中(spinner) / 已提取·待测。 */
function RowState({ row, recognizing, judging }: { row: LintRow; recognizing: boolean; judging: boolean }) {
  if (row.judgment) {
    const v = row.judgment.verdict;
    return <span className={`flex-none rounded px-1.5 py-0.5 text-[10px] ${VERDICT_CLS[v]}`}>{t(VERDICT_LABEL[v])}</span>;
  }
  if (row.aiMark) {
    return <span className="flex-none rounded bg-(--tmd-accent)/5 px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">{t("待判定")}</span>;
  }
  if (judging) {
    return (
      <span className="flex flex-none items-center gap-1 rounded bg-(--tmd-accent)/10 px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">
        <Spinner />
        {t("判定中")}
      </span>
    );
  }
  if (recognizing) {
    return (
      <span className="flex flex-none items-center gap-1 rounded bg-(--tmd-accent)/10 px-1.5 py-0.5 text-[10px] text-(--tmd-accent)">
        <Spinner />
        {t("识别中")}
      </span>
    );
  }
  return (
    <span className="flex-none animate-pulse rounded bg-(--tmd-bg-subtle) px-1.5 py-0.5 text-[10px] text-(--tmd-fg-muted)">{t("已提取 · 待测")}</span>
  );
}

/** 单个文件的规则行组(从主体拆出,压 react-doctor 控制流复杂度)。 */
function FileGroup({ absPath, rows, recognizing, judgingFile }: { absPath: string; rows: LintRow[]; recognizing: boolean; judgingFile: string | null }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 border-b border-(--tmd-border) pb-1 text-[11px] font-medium text-(--tmd-fg-muted)">
        <span className="min-w-0 truncate font-mono">{absPath}</span>
        <span className="ml-auto flex-none rounded bg-(--tmd-bg-subtle) px-1.5 text-[10px]">{t("{n} 条", { n: String(rows.length) })}</span>
      </div>
      {rows.map((row) => (
        <div key={`${row.rule.file}:${row.rule.line}`} className="my-1 flex items-center gap-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-2 py-1.5 text-[11px]">
          <RowState row={row} recognizing={recognizing} judging={judgingFile === row.rule.file.split("/").pop()} />
          <span className="min-w-0 flex-1 truncate font-mono">{row.rule.text}</span>
          <span className="flex-none font-mono text-[10px] text-(--tmd-fg-faint)">L{row.rule.line}</span>
        </div>
      ))}
    </div>
  );
}

export function LintProcessing({
  result, progress, engineId, model,
}: {
  result: LintRunResult | null;
  progress: LintProgress | null;
  engineId: string;
  model: string;
}) {
  const rows = result?.rows ?? [];
  const judged = rows.filter((r) => r.judgment).length;
  const current = rows.find((r) => !r.judgment);
  const recognizing = progress?.step === "recognize";
  const judgingFile = progress?.step === "judge" && progress.detail ? progress.detail : null;
  const waiting = (progress?.waitSec ?? 0) > 3;
  const pct = percentOf(progress);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-(--tmd-border) px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-(--tmd-fg)">{t("规则体检 · 处理中")}</span>
          <span className="rounded-full bg-(--tmd-accent)/10 px-2 py-0.5 text-[10px] text-(--tmd-accent)">
            {progress?.step === "judge" ? t("AI 逐条判定") : t("脚本扫描")}
          </span>
        </div>
        <div className="mt-1 text-meta text-(--tmd-fg-faint)">
          {waiting
            ? t("AI 判定中 · 已等 {s}s · 单次调用(引擎输出会缓冲,完成即整批上屏)", { s: String(progress?.waitSec ?? 0) })
            : t("已判定 {d}/{t} · {w}", { d: String(judged), t: String(rows.length), w: current ? t("当前批次：{f}", { f: current.rule.file.split("/").pop() ?? "" }) : t("批次收尾中") })}
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--tmd-bg-subtle)">
          <div className="h-full rounded-full bg-(--tmd-accent) transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 text-meta text-(--tmd-fg-faint)">
          {engineId} · {model || t("默认模型")} · {t("发给模型 = 规则 + 脚本测量摘要,对话原文不出本机 · 超时上限 1200s")}
        </div>
      </div>
      <div className="grid flex-1 min-h-0 grid-cols-[minmax(0,1fr)_295px]">
        <div className="min-h-0 border-r border-(--tmd-border) px-3 py-2">
          {result?.targets.map((target) => {
            const group = rows.filter((r) => r.rule.file === target.absPath);
            if (group.length === 0) return null;
            return <FileGroup key={target.absPath} absPath={target.absPath} rows={group} recognizing={recognizing} judgingFile={judgingFile} />;
          })}
          {rows.length === 0 && <div className="py-3 text-center text-xs text-(--tmd-fg-faint)">{t("规则提取后逐条上屏…")}</div>}
        </div>
        <CurrentRuleCard current={current} />
      </div>
    </div>
  );
}

/** 右栏当前规则卡(从主体拆出,压 react-doctor 控制流复杂度)。 */
function CurrentRuleCard({ current }: { current: LintRow | undefined }) {
  if (!current) {
    return (
      <aside className="min-h-0 bg-(--tmd-bg-subtle) px-3 py-2.5">
        <p className="text-meta text-(--tmd-fg-faint)">{t("脚本扫描中,规则提取后这里显示当前批次的规则与脚本计数。")}</p>
      </aside>
    );
  }
  return (
    <aside className="min-h-0 bg-(--tmd-bg-subtle) px-3 py-2.5">
      <span className="rounded-full bg-(--tmd-accent)/10 px-2 py-0.5 text-[10px] text-(--tmd-accent)">{t("当前规则")}</span>
      <h3 className="mt-1.5 font-mono text-xs text-(--tmd-fg)">{current.rule.file.split("/").pop()} · L{current.rule.line}</h3>
      <div className="mt-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 font-mono text-[10px] leading-relaxed text-(--tmd-fg-muted)">{current.rule.text}</div>
      <div className="mt-3 text-[10px] font-medium tracking-wide text-(--tmd-fg-faint)">{t("脚本测量摘要(随规则发模型)")}</div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{current.evidence?.hits ?? "—"}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("触达消息")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{current.evidence?.activeSessions ?? "—"}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("相关会话")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{current.evidence?.corrections ?? "—"}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("当场纠正")}</span></div>
      </div>
      <p className="mt-2.5 text-[10px] leading-relaxed text-(--tmd-fg-faint)">{t("AI 只看规则原文与这些计数,给出最终判定;对话原文不出本机。")}</p>
    </aside>
  );
}

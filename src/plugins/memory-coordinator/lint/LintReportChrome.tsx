/**
 * 规则体检报告 · 头部与统计卡。
 * 只消费控制器已有状态:三阶段步进、范围筛选、主操作与结果计数。
 */

import { Fragment } from "react";
import {
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  FileTextIcon as FileText,
  MagicWandIcon as MagicWand,
  MagnifyingGlassIcon as MagnifyingGlass,
  PulseIcon as Pulse,
  SparkleIcon as Sparkle,
} from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import type { LintRunResult } from "./lintModel";
import type { LintScope } from "./lintTypes";

export type ScopeFilter = "all" | LintScope;
type Phase = "scan" | "ai" | "review";

function LintSteps({ phase, running }: { phase: Phase; running: boolean }) {
  const active = phase === "scan" ? 0 : phase === "ai" ? 1 : 2;
  const steps = [
    { label: t("脚本扫描"), Icon: MagnifyingGlass },
    { label: t("AI 识别"), Icon: Sparkle },
    { label: t("审核应用"), Icon: CheckCircle },
  ];
  return (
    <ol aria-label={t("体检阶段")} className="flex items-center px-4 pt-2.5 pb-3">
      {steps.map(({ label, Icon }, i) => {
        const done = i < active;
        const current = i === active;
        return (
          <Fragment key={label}>
            <li
              aria-current={current ? "step" : undefined}
              className={`flex flex-none items-center gap-1.5 text-meta font-medium ${done ? "text-(--tmd-ok)" : current ? "text-(--tmd-accent)" : "text-(--tmd-fg-faint)"}`}
            >
              <span className={`grid size-6 place-items-center rounded-full border ${done ? "border-(--tmd-ok)/25 bg-(--tmd-ok)/10" : current ? "border-(--tmd-accent)/30 bg-(--tmd-accent)/10" : "border-(--tmd-border) bg-(--tmd-bg-subtle)"} ${current && running ? "motion-safe:animate-pulse" : ""}`}>
                {done ? <Check size={12} weight="bold" aria-hidden /> : <Icon size={12} aria-hidden />}
              </span>
              {label}
            </li>
            {i < steps.length - 1 && <li aria-hidden className={`mx-3 h-px min-w-4 flex-1 ${i < active ? "bg-(--tmd-ok)/35" : "bg-(--tmd-border)"}`} />}
          </Fragment>
        );
      })}
    </ol>
  );
}

/** 报告头:标题、路径、筛选与主操作同排,窄容器自然换行。 */
export function ReportToolbar({
  cwd, running, failed, hasResult, phase, scopeFilter, setScopeFilter, pendingCount, busy, onStart, onApplyAll,
}: {
  cwd: string | null; running: boolean; failed: boolean; hasResult: boolean; phase: Phase;
  scopeFilter: ScopeFilter; setScopeFilter: (s: ScopeFilter) => void;
  pendingCount: number; busy: boolean; onStart: () => void; onApplyAll: () => void;
}) {
  return (
    <header className="flex-none border-b border-(--tmd-border) bg-(--tmd-bg-elevated)">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <span className="grid size-7 place-items-center rounded-lg bg-(--tmd-accent)/10 text-(--tmd-accent)">
          <Pulse size={15} aria-hidden />
        </span>
        <h2 className="text-xs font-semibold text-(--tmd-fg)">{t("规则体检报告")}</h2>
        {running ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-(--tmd-accent)/10 px-2 py-0.5 text-[10px] text-(--tmd-accent)">
            <Spinner />{t("正在运行")}
          </span>
        ) : failed ? (
          <span className="rounded-full bg-(--tmd-error)/10 px-2 py-0.5 text-[10px] text-(--tmd-error)">{t("体检失败")}</span>
        ) : hasResult ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-(--tmd-ok)/10 px-2 py-0.5 text-[10px] text-(--tmd-ok)">
            <CheckCircle size={11} aria-hidden />{t("本轮已完成")}
          </span>
        ) : null}
        <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 text-meta text-(--tmd-fg-muted)" title={cwd ?? ""}>
          <FileText className="flex-none" size={12} aria-hidden />
          <span className="truncate font-mono">{cwd ?? ""}</span>
        </span>
        <div className="flex flex-none rounded-md border border-(--tmd-border) bg-(--tmd-bg-subtle) p-0.5" role="group" aria-label={t("规则范围")}>
          {(["all", "project", "global"] as ScopeFilter[]).map((s) => (
            <button
              key={s} type="button" onClick={() => setScopeFilter(s)} aria-pressed={scopeFilter === s}
              className={`rounded px-2 py-0.5 text-meta transition-colors ${scopeFilter === s ? "bg-(--tmd-bg-elevated) text-(--tmd-accent) shadow-sm" : "text-(--tmd-fg-muted) hover:text-(--tmd-fg)"}`}
            >
              {t(s === "all" ? "全部" : s === "project" ? "项目规则" : "全局规则")}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button" disabled={busy || pendingCount === 0} onClick={onApplyAll} aria-busy={busy}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--tmd-accent) bg-(--tmd-accent) px-2.5 py-1 text-meta text-(--tmd-accent-fg) transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Spinner /> : <MagicWand size={12} aria-hidden />}
            {busy ? t("应用中") : `${t("一键应用 AI 结果")} · ${pendingCount}`}
          </button>
          <button
            type="button" onClick={onStart} disabled={running || !cwd} aria-busy={running}
            className="inline-flex items-center gap-1.5 rounded-md border border-(--tmd-border) px-2.5 py-1 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:cursor-not-allowed disabled:opacity-40"
          >
            {running ? <Spinner /> : <Pulse size={12} aria-hidden />}
            {running ? t("体检中") : t("体检")}
          </button>
        </div>
      </div>
      <LintSteps phase={phase} running={running} />
    </header>
  );
}

function StatCard({ value, label, Icon, iconCls }: { value: number; label: string; Icon: typeof FileText; iconCls: string }) {
  return (
    <div className="rounded-lg border border-(--tmd-border) bg-(--tmd-bg-elevated) px-3 py-2 transition-colors hover:border-(--tmd-accent)/35 hover:bg-(--tmd-accent)/5">
      <div className="flex items-start justify-between gap-2">
        <b className="text-xl leading-6 font-semibold text-(--tmd-fg)">{value}</b>
        <span className={`rounded-md p-1 ${iconCls}`}><Icon size={13} aria-hidden /></span>
      </div>
      <span className="mt-0.5 block text-meta text-(--tmd-fg-muted)">{label}</span>
    </div>
  );
}

export function ReportStats({ result }: { result: LintRunResult }) {
  const files = new Set(result.rows.map((r) => r.rule.file)).size;
  const recognized = result.rows.filter((r) => r.aiMark).length;
  const needsRewrite = result.rows.filter((r) => r.aiMark && !r.aiMark.recognizable && r.aiMark.rewrite && !r.settled).length;
  const settled = result.rows.filter((r) => r.settled).length;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2 px-3 py-3">
      <StatCard value={files} label={t("已扫描文件")} Icon={FileText} iconCls="bg-(--tmd-bg-subtle) text-(--tmd-fg-muted)" />
      <StatCard value={recognized} label={t("AI 已识别")} Icon={Sparkle} iconCls="bg-(--tmd-accent)/10 text-(--tmd-accent)" />
      <StatCard value={needsRewrite} label={t("需修改规则")} Icon={MagicWand} iconCls="bg-(--tmd-warn)/10 text-(--tmd-warn)" />
      <StatCard value={settled} label={t("已处理")} Icon={CheckCircle} iconCls="bg-(--tmd-ok)/10 text-(--tmd-ok)" />
    </div>
  );
}

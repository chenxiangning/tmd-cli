/**
 * 规则体检 · 行组件面(自 LintView 拆出守 300 行铁则)。
 * 纯展示与行内动作派发:判定点/证据下钻/建议动作钮;写回编排归 lintPanelState。
 */

import { openFileInTab } from "@kernel/fileTabs";
import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import { ADVICE_LABEL, VERDICT_DOT, VERDICT_LABEL, type LintAdvice, type LintRow, type LintVerdict, type StaticFinding } from "./lintTypes";
import type { DiffLine } from "./diffUtil";

const ACTION_CLS =
  "flex-none rounded border border-(--tmd-border) px-2 py-0.5 text-meta text-(--tmd-fg-muted) transition-colors hover:border-(--tmd-accent) hover:text-(--tmd-accent) disabled:opacity-50 disabled:hover:border-(--tmd-border) disabled:hover:text-(--tmd-fg-muted)";

function dayOf(ts: number): string {
  return ts ? new Date(ts).toISOString().slice(0, 10) : "—";
}

/** 展开态证据面:指标行 + 引文 + AI 理由。 */
function EvidenceFace({ row }: { row: LintRow }) {
  const ev = row.evidence;
  return (
    <div className="space-y-1 px-3 pb-2 pt-0.5 text-meta leading-relaxed text-(--tmd-fg-muted)">
      <div>
        {t("触达 {n} 条消息/{s} 个会话,最近 {d};纠正 {c} 次;工具级照做 {p} 次", {
          n: String(ev.hits), s: String(ev.activeSessions), d: dayOf(ev.lastSeen), c: String(ev.corrections), p: String(ev.complied),
        })}
        {ev.command ? ` · ${t("规则命令")}: ${ev.command}` : ""}
      </div>
      {ev.correctionQuotes.map((q) => (
        <div key={q} className="border-l-2 border-(--tmd-error) pl-2 text-(--tmd-fg)">
          {t("纠正原话")}:「{q}」
        </div>
      ))}
      {ev.complyQuote && (
        <div className="border-l-2 border-(--tmd-ok) pl-2 font-mono text-(--tmd-fg)">{ev.complyQuote}</div>
      )}
      {ev.unjudgeable && <div>{t("信号词全部超高频,词面证据不可用,判定仅基于以上硬证据")}</div>}
      {row.judgment ? (
        <div className="text-(--tmd-fg)">
          {t("AI 判定")}:{row.judgment.reason || t(VERDICT_LABEL[row.judgment.verdict])}
        </div>
      ) : (
        <div className="text-(--tmd-warn)">{t("本条 AI 判定失败,未回落猜测;可重新体检")}</div>
      )}
    </div>
  );
}

/** 单条规则行:判定点 + 规则文(点开下钻)+ 建议动作(hook/拍板/重开)。 */
export function RuleRow({
  row,
  busy,
  onApply,
  onKeep,
  onHook,
  onReopen,
}: {
  row: LintRow;
  busy: boolean;
  onApply: (row: LintRow, advice: LintAdvice) => void;
  onKeep: (row: LintRow) => void;
  onHook: (row: LintRow) => void;
  onReopen: (row: LintRow) => void;
}) {
  const state: LintVerdict | "failed" | "settled" = row.settled
    ? "settled"
    : row.judgment
      ? row.judgment.verdict
      : "failed";
  const advice = row.judgment?.advice ?? "keep";
  const keepable = row.judgment && (row.judgment.verdict === "violated" || row.judgment.verdict === "dormant");
  return (
    <details className="group px-1.5">
      <summary className="flex h-7 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
        <span className={`size-[7px] flex-none rounded-full ${VERDICT_DOT[state]}`} aria-hidden />
        <span className="w-14 flex-none truncate text-meta text-(--tmd-fg-muted)">{t(VERDICT_LABEL[state])}</span>
        <span className="min-w-0 truncate font-mono text-xs text-(--tmd-fg) group-hover:text-(--tmd-accent)">
          {row.rule.text.split("\n")[0]}
        </span>
        <span className="ml-auto flex-none text-meta text-(--tmd-fg-faint)">L{row.rule.line}</span>
      </summary>
      <EvidenceFace row={row} />
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5">
        {!row.settled && row.judgment && advice !== "keep" && (
          <button type="button" disabled={busy} onClick={() => onApply(row, advice)} className={ACTION_CLS}>
            {busy ? <Spinner /> : t("按建议处理")}:{t(ADVICE_LABEL[advice])}
          </button>
        )}
        {!row.settled && row.evidence.command && (
          <button type="button" disabled={busy} onClick={() => onHook(row)} className={ACTION_CLS} title={t("把规则命令写进 pre-commit,机器把关")}>
            {t("上 pre-commit")}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => openFileInTab(row.rule.file)} className={ACTION_CLS}>
          {t("打开")}
        </button>
        {row.settled ? (
          <>
            <span className="text-meta text-(--tmd-fg-faint)">{t("已拍板:此前处理过,不再重复报")}</span>
            <button type="button" disabled={busy} onClick={() => onReopen(row)} className={ACTION_CLS}>
              {t("重开")}
            </button>
          </>
        ) : keepable ? (
          <button type="button" disabled={busy} onClick={() => onKeep(row)} className={ACTION_CLS}>
            {t("保持并拍板")}
          </button>
        ) : null}
      </div>
    </details>
  );
}

/** 静态发现行(drift/stale+fixpath/missing):确定性检查,不烧模型。 */
export function FindingRow({
  finding,
  busy,
  onStub,
  onWrite,
  onFixpath,
}: {
  finding: StaticFinding;
  busy: boolean;
  onStub: (finding: StaticFinding) => void;
  onWrite: (finding: StaticFinding) => void;
  onFixpath: (finding: StaticFinding) => void;
}) {
  const label =
    finding.kind === "drift" ? t("两文件打架") : finding.kind === "missing" ? t("你反复在说") : t("引用失效");
  const dot =
    finding.kind === "drift" ? "bg-(--tmd-warn)" : finding.kind === "missing" ? "bg-(--tmd-accent)" : "bg-(--tmd-border)";
  return (
    <div className="flex h-7 items-center gap-2 px-1.5">
      <span className={`size-[7px] flex-none rounded-full ${dot}`} aria-hidden />
      <span className="w-14 flex-none truncate text-meta text-(--tmd-fg-muted)">{label}</span>
      <span className="min-w-0 truncate font-mono text-xs text-(--tmd-fg)" title={finding.text}>
        {finding.kind === "drift" ? finding.file.split("/").pop() : finding.text.split("\n")[0]}
      </span>
      {finding.extra && finding.kind !== "drift" && (
        <span className="flex-none text-meta text-(--tmd-fg-faint)">{finding.extra}</span>
      )}
      <span className="ml-auto flex flex-none items-center gap-1.5">
        {finding.kind === "drift" && (
          <button type="button" disabled={busy} onClick={() => onStub(finding)} className={ACTION_CLS} title={finding.file}>
            {busy ? <Spinner /> : t("收口 stub")}
          </button>
        )}
        {finding.kind === "missing" && (
          <button type="button" disabled={busy} onClick={() => onWrite(finding)} className={ACTION_CLS} title={finding.file}>
            {t("写进 AGENTS.md")}
          </button>
        )}
        {finding.kind === "stale" && finding.advice === "fixpath" && (
          <button type="button" disabled={busy} onClick={() => onFixpath(finding)} className={ACTION_CLS} title={finding.extra}>
            {t("修路径")}
          </button>
        )}
        <button type="button" onClick={() => openFileInTab(finding.file)} className={ACTION_CLS}>
          {t("打开")}
        </button>
      </span>
    </div>
  );
}

/** diff 预览块(确认弹层内;超 24 行截断)。 */
export function DiffPreview({ lines }: { lines: DiffLine[] }) {
  const shown = lines.slice(0, 24);
  return (
    <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded border border-(--tmd-border) bg-(--tmd-bg-subtle) p-1.5 font-mono text-[10px] leading-snug">
      {shown.map((l) => (
        <div
          key={`${l.kind}:${l.text}`}
          className={l.kind === "del" ? "text-(--tmd-error)" : l.kind === "add" ? "text-(--tmd-ok)" : "text-(--tmd-fg-faint)"}
        >
          {l.kind === "del" ? "- " : l.kind === "add" ? "+ " : "  "}
          {l.text}
        </div>
      ))}
      {lines.length > shown.length && <div className="text-(--tmd-fg-faint)">…</div>}
    </pre>
  );
}

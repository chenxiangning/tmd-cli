/**
 * 选中规则右侧详情面板(报告页):识别/判定说明 + 脚本测量摘要 +
 * 改写 diff + 动作(应用 AI 建议/保持并拍板/打开)。与行内下钻互为联动。
 */

import { openFileAtLine } from "@kernel/fileTabs";
import { t } from "@kernel/i18n";
import type { LintRow } from "./lintTypes";
import { VERDICT_LABEL } from "./lintTypes";
import { ACTION_CLS } from "./LintRows";
import { KEEPABLE, pendingRewrite } from "./lintTypes";

/** 脚本测量三格(触达/会话/纠正)。 */
function EvidenceGrid({ row }: { row: LintRow }) {
  if (!row.evidence) return null;
  return (
    <>
      <div className="mt-2.5 text-[10px] font-medium tracking-wide text-(--tmd-fg-faint)">{t("脚本测量摘要(随规则发模型)")}</div>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{row.evidence.hits}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("触达消息")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{row.evidence.activeSessions}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("相关会话")}</span></div>
        <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) px-1 py-1.5 text-center"><b className="block text-sm">{row.evidence.corrections}</b><span className="text-[9px] text-(--tmd-fg-faint)">{t("当场纠正")}</span></div>
      </div>
    </>
  );
}

/** 改写 diff 预览(pendingRewrite 任一存在)。 */
function RewriteDiff({ row }: { row: LintRow }) {
  const rewrite = pendingRewrite(row);
  if (!rewrite) return null;
  return (
    <div className="mt-2.5">
      <div className="text-[10px] font-medium tracking-wide text-(--tmd-fg-faint)">{t("规则变更预览")}</div>
      <div className="mt-1.5 overflow-hidden rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) font-mono text-[9.5px] leading-relaxed">
        <div className="border-b border-(--tmd-border) bg-(--tmd-error)/10 px-2 py-1 text-(--tmd-error)">- {row.rule.text}</div>
        <div className="bg-(--tmd-ok)/10 px-2 py-1 text-(--tmd-ok)">+ {rewrite}</div>
      </div>
    </div>
  );
}

export function RuleDetailPanel({ row, busy, onKeep, onRewrite }: { row: LintRow; busy: boolean; onKeep: (row: LintRow) => void; onRewrite: (row: LintRow) => void }) {
  const keepable = row.judgment !== null && KEEPABLE[row.judgment.verdict] === true && !row.settled;
  const rewritable = !!pendingRewrite(row);
  return (
    <aside className="w-[300px] flex-none border-l border-(--tmd-border) bg-(--tmd-bg-subtle) px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="rounded-full bg-(--tmd-accent)/10 px-2 py-0.5 text-[10px] text-(--tmd-accent)">{t("选中规则")}</span>
        <span className="ml-auto font-mono text-[10px] text-(--tmd-fg-faint)">L{row.rule.line}</span>
      </div>
      <div className="mt-2 rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-2 font-mono text-[10px] leading-relaxed text-(--tmd-fg-muted)">{row.rule.text}</div>
      {row.aiMark && (
        <div className="mt-2.5">
          <div className="text-[10px] font-medium tracking-wide text-(--tmd-fg-faint)">{t("AI 识别")}</div>
          <p className={`mt-1 text-[10px] leading-relaxed ${row.aiMark.recognizable ? "text-(--tmd-ok)" : "text-(--tmd-warn)"}`}>
            {row.aiMark.recognizable ? t("能识别并遵守") : t("不能识别/执行")} —— {row.aiMark.reason}
          </p>
        </div>
      )}
      {row.judgment && (
        <div className="mt-2.5">
          <div className="text-[10px] font-medium tracking-wide text-(--tmd-fg-faint)">{t("AI 判定")}</div>
          <p className="mt-1 text-[10px] leading-relaxed text-(--tmd-fg-muted)">
            {t(VERDICT_LABEL[row.judgment.verdict])}{row.judgment.reason ? ` —— ${row.judgment.reason}` : ""}
          </p>
        </div>
      )}
      <EvidenceGrid row={row} />
      {rewritable && <RewriteDiff row={row} />}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {rewritable && (
          <button type="button" disabled={busy} onClick={() => onRewrite(row)} className="rounded border border-(--tmd-accent) px-2 py-1 text-meta text-(--tmd-accent) transition-colors hover:bg-(--tmd-accent)/10 disabled:opacity-50">{t("应用 AI 建议")}</button>
        )}
        {keepable && !row.settled && (
          <button type="button" disabled={busy} onClick={() => onKeep(row)} className={ACTION_CLS}>{t("保持并拍板")}</button>
        )}
        <button type="button" onClick={() => openFileAtLine(row.rule.file, row.rule.line)} className={ACTION_CLS}>{t("打开")}</button>
      </div>
    </aside>
  );
}

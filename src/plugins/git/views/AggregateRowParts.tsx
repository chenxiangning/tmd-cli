/**
 * AggregateRowParts —— 聚合仓行的行内拆件(自 AggregateReposView 拆出,
 * only-export-components;主文件 300 行铁则贴线,拆出给后续改动留余量)。
 * RowStatus:单行状态列(执行结果优先于 ↑↓ 常态;结果保留到下次执行/手动 ⟳)。
 * RowQuickOps:行级快操(hover 显):拉取需上游;推送 ahead>0 即可(无上游走缺省目标)。
 */

import { t } from "@kernel/i18n";
import { Spinner } from "@kernel/Spinner";
import type { AggRepo, BatchOp } from "../aggregateModel";
import type { RowResult } from "../useBatchGitOps";

export function RowStatus({ repo, result }: { repo: AggRepo; result: RowResult | undefined }) {
  if (result) {
    if (result.phase === "running") {
      return (
        <span className="flex items-center gap-1 text-(--tmd-fg-muted)">
          <Spinner /> {t("{op}中…", { op: result.text })}
        </span>
      );
    }
    if (result.phase === "queued") return <span className="text-(--tmd-fg-faint)">{t("排队…")}</span>;
    if (result.phase === "ok") return <span className="text-(--tmd-diff-inserted)">✓ {result.text}</span>;
    if (result.phase === "skip") return <span className="text-(--tmd-fg-faint)">⊘ {result.text}</span>;
    return <span className="text-(--tmd-diff-removed)" title={result.text}>✗ {result.text}</span>;
  }
  return (
    <span className="tabular-nums text-(--tmd-fg-muted)">
      <span className="text-(--tmd-diff-inserted)">↑{repo.ahead}</span>{" "}
      <span className="text-(--tmd-diff-removed)">↓{repo.behind}</span>
      {repo.dirty > 0 && <span className="text-(--tmd-git-modified)"> · {t("{n} 改动", { n: repo.dirty })}</span>}
    </span>
  );
}

export function RowQuickOps({ repo: r, onOp }: { repo: AggRepo; onOp: (op: BatchOp) => void }) {
  const ops = [{ op: "pull" as const, on: r.upstream != null }, { op: "push" as const, on: r.ahead > 0 }].filter((o) => o.on);
  return (
    <span className="hidden shrink-0 gap-2 pr-2.5 group-hover:flex">
      {ops.map(({ op }) => (
        <button
          key={op}
          type="button"
          onClick={(e) => { e.stopPropagation(); onOp(op); }}
          className="text-[11px] text-(--tmd-fg-faint) hover:text-(--tmd-fg) hover:underline"
        >
          {t(op === "pull" ? "拉取" : "推送")}
        </button>
      ))}
    </span>
  );
}

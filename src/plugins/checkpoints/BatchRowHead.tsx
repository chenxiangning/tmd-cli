/**
 * BatchRow 批头拆件 —— 批头按钮(状态点 + prompt 摘要 + ±stats + 状态徽标 +
 * 归因标记),点击开审阅单(no-high-complexity 降分支 + 文件规模铁则):
 * 按钮内部再按悬浮文案/状态点/标题行/徽标簇细分,各函数分支 <10。
 */

import { formatAbsolute, formatRelativeTime } from "@kernel/relativeTime";
import { t } from "@kernel/i18n";
import type { CkptBatch, CkptPatch } from "@kernel/ipc";
import { getCachedDiff } from "./store";
import { openBatchTab } from "./batchTab";
import { STATE_META, batchState, type BatchStateKey, type BatchStateMeta } from "./batchStateMeta";

/** 批头悬浮文案:发起/封口时刻(降分支拆件)。 */
function headTitle(b: CkptBatch): string {
  return t("点击审阅该批(用户消息 + 文件 diff) · {ts}", {
    ts: b.tsEnd
      ? t("{start} 发起 · {end} 封口", { start: formatAbsolute(b.ts), end: formatAbsolute(b.tsEnd) })
      : t("{start} 发起", { start: formatAbsolute(b.ts) }),
  });
}

/** 状态点:open 呼吸动画,done 空心(降分支拆件)。 */
function BatchDot({ st, dot }: { st: BatchStateKey; dot: string }) {
  return (
    <span
      className={`mt-0.5 h-3 w-3 flex-none rounded-full border-2 border-(--tmd-border-strong) ${st === "open" ? "animate-pulse" : ""}`}
      style={{ borderColor: dot, background: st === "done" ? "transparent" : dot }}
      aria-hidden
    />
  );
}

/** 批次标题行:#序号 + prompt 首行(已退批划线淡出)(降分支拆件)。 */
function BatchPromptLine({ b, st }: { b: CkptBatch; st: BatchStateKey }) {
  return (
    <span className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap text-xs">
      <span className="flex-none text-[0.6875rem] text-(--tmd-fg-faint)">#{b.index}</span>
      <span
        className={`truncate font-medium ${st === "reverted" ? "text-(--tmd-fg-faint) line-through" : "text-(--tmd-fg)"}`}
      >
        {b.prompt.split("\n")[0]}
      </span>
    </span>
  );
}

/** 状态徽标:chip 配色 + 归因悬浮说明,done 附封口原因(降分支拆件)。 */
function BatchStateChip({ b, st, meta }: { b: CkptBatch; st: BatchStateKey; meta: BatchStateMeta }) {
  return (
    <span
      className={`flex-none rounded-full px-1.5 text-[0.625rem] font-semibold leading-[0.875rem] ${meta.chip}`}
      title={b.attribution === "events" ? t("归因:AI 写入事件流(账本只记 CLI 声称写过的文件)") : t("归因:窗口内 git 变更推断(该 CLI 未声明写入事件检测,可能有误差)")}
    >
      {t(meta.label)}
      {st === "done" && b.doneReason ? ` · ${t(b.doneReason)}` : ""}
    </span>
  );
}

/** 推断徽标:仅 git 归因且已封口时显示(降分支拆件)。 */
function BatchInferBadge({ b }: { b: CkptBatch }) {
  if (!(b.attribution === "git" && !b.open)) return null;
  return (
    <span
      className="flex-none rounded border border-dashed border-(--tmd-border-strong) px-1 text-[0.5625rem] leading-[0.8125rem] text-(--tmd-fg-faint)"
      title={t("该 CLI 未声明写入事件检测:批次由 git 变更推断,可能混入手改")}
    >
      {t("推断")}
    </span>
  );
}

/** 引擎/模型/思考摘要 tag(账本随批固化)(降分支拆件)。 */
function BatchEngineTag({ b }: { b: CkptBatch }) {
  if (!b.engine && !b.model) return null;
  return (
    <span
      className="min-w-0 truncate text-[0.625rem]"
      title={[b.engine, b.model, b.thinking ? t("思考 {level}", { level: b.thinking }) : ""].filter(Boolean).join(" · ")}
    >
      {b.engine}
      {b.engine && b.model ? " · " : ""}
      {b.model}
    </span>
  );
}

/** 批 ± 汇总(来自懒加载 patch;未加载/open 批返回 null,UI 显示占位)。 */
function batchStats(patches: CkptPatch[] | undefined): { ins: number; del: number } | null {
  if (!patches) return null;
  return {
    ins: patches.reduce((s, p) => s + p.additions, 0),
    del: patches.reduce((s, p) => s + p.deletions, 0),
  };
}

/** 批头按钮:状态点 + prompt 摘要 + ±stats + 状态徽标 + 归因标记,点击开审阅单(降分支拆件)。 */
export function BatchHeadButton({
  b,
  cwd,
  sessionId,
  tmdSessionId,
}: {
  b: CkptBatch;
  cwd: string;
  sessionId: string;
  tmdSessionId?: string;
}) {
  const st = batchState(b);
  const meta = STATE_META[st];
  const stats = batchStats(getCachedDiff(cwd, b.id));
  return (
    <button
      type="button"
      className="relative z-[1] flex w-full items-start gap-1.5 rounded-(--tmd-radius-sm) py-1.5 pl-0.5 pr-1.5 text-left hover:bg-(--tmd-bg-hover)"
      title={headTitle(b)}
      onClick={() =>
        openBatchTab({ cwd, sessionId, tmdSessionId, batchId: b.id, title: t("批次 #{index}", { index: b.index }) })
      }
    >
      <BatchDot st={st} dot={meta.dot} />
      <span className="min-w-0 flex-1">
        {/* 批次标题:text-xs 基准对齐面板体系(此前继承根字号 16px,偏大) */}
        <BatchPromptLine b={b} st={st} />
        <span className="mt-px flex items-center gap-1.5 overflow-hidden whitespace-nowrap text-[0.6875rem] text-(--tmd-fg-faint)">
          <span className="flex-none">{t("{n} 文件", { n: b.files.length })}</span>
          {stats && (
            <span className="flex-none font-mono">
              <span className="text-(--tmd-diff-inserted)">+{stats.ins}</span>{" "}
              <span className="text-(--tmd-diff-removed)">−{stats.del}</span>
            </span>
          )}
          <BatchStateChip b={b} st={st} meta={meta} />
          <BatchInferBadge b={b} />
          <BatchEngineTag b={b} />
          <span className="ml-auto flex-none" title={formatAbsolute(b.ts)}>
            {formatRelativeTime(b.ts)}
          </span>
        </span>
      </span>
    </button>
  );
}

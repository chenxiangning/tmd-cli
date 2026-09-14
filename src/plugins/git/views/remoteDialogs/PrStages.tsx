/**
 * PrStages —— 创建 PR 四步进度卡 + 结果区(mossx「执行进度」同构)。
 * 状态着色:success 绿 / failed 红 / running accent 转圈 / skipped 与 pending 暗灰。
 */

import { t } from "@kernel/i18n";
import { CircleNotch, Copy, Minus, Warning, XCircle, CheckCircle } from "@phosphor-icons/react";
import type { GitPrStage, GitPrWorkflowResult } from "@kernel/ipc";

const STAGE_LABEL: Record<GitPrStage["key"], string> = {
  precheck: "Precheck",
  push: "Push",
  createPr: "Create PR",
  comment: "Comment",
};
/** Rust 侧 GitError Display 会带 E_XXX: 前缀,UI 展示统一剥掉。 */
const ERR_PREFIX_RE = /E_[A-Z0-9]+: /g;
const STATUS_TEXT: Record<GitPrStage["status"], string> = {
  pending: "等待",
  running: "执行中",
  success: "成功",
  failed: "失败",
  skipped: "跳过",
};
/** 状态 → 语义色(success 绿 / failed 红 / running accent / 其余暗灰)。 */
function stageColor(status: GitPrStage["status"]): string {
  if (status === "success") return "text-(--tmd-diff-inserted)";
  if (status === "failed") return "text-(--tmd-diff-removed)";
  if (status === "running") return "text-(--tmd-accent)";
  return "text-(--tmd-fg-faint)";
}

/** 状态 → 行前图标(running 转圈;pending 半透明)。 */
function stageIcon(status: GitPrStage["status"]) {
  const cls = "h-[0.875rem] w-[0.875rem]";
  if (status === "success") return <CheckCircle className={cls} aria-hidden />;
  if (status === "failed") return <XCircle className={cls} aria-hidden />;
  if (status === "running") return <CircleNotch className={`${cls} animate-spin`} aria-hidden />;
  if (status === "skipped") return <Minus className={cls} aria-hidden />;
  return <CircleNotch className={`${cls} opacity-30`} aria-hidden />;
}

function StageCard({ stage }: { stage: GitPrStage }) {
  const color = stageColor(stage.status);
  const icon = stageIcon(stage.status);
  return (
    <div className="rounded-md border border-(--tmd-border) bg-(--tmd-bg-sunken) p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-1.5">
          <span className={`mt-0.5 shrink-0 ${color}`}>{icon}</span>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-(--tmd-fg)">{STAGE_LABEL[stage.key]}</div>
            {stage.detail && (
              <div className="mt-0.5 break-words text-[0.6875rem] leading-4 text-(--tmd-fg-muted)">
                {stage.detail.replace(ERR_PREFIX_RE, "")}
              </div>
            )}
          </div>
        </div>
        <span className={`shrink-0 text-[0.6875rem] ${color}`}>{t(STATUS_TEXT[stage.status])}</span>
      </div>
    </div>
  );
}

/** 四步进度卡;result 非空时附结果行(PR 号 + message + 复制链接)。 */
export function PrStages({
  stages,
  result,
  onCopy,
}: {
  stages: GitPrStage[];
  result: GitPrWorkflowResult | null;
  onCopy: (url: string) => void;
}) {
  if (stages.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-(--tmd-border) p-2.5">
      <div className="text-xs font-semibold text-(--tmd-fg)">{t("执行进度")}</div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {stages.map((s) => (
          <StageCard key={s.key} stage={s} />
        ))}
      </div>
      {result && (
        <div className="mt-2 rounded bg-(--tmd-bg-sunken) p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-(--tmd-fg)">
              {result.ok ? (
                <CheckCircle className="h-[0.875rem] w-[0.875rem] shrink-0 text-(--tmd-diff-inserted)" aria-hidden />
              ) : (
                <Warning className="h-[0.875rem] w-[0.875rem] shrink-0 text-(--tmd-diff-removed)" aria-hidden />
              )}
              {result.ok ? t("PR 创建成功") : t("PR 工作流未完成")}
              {result.prNumber != null && (
                <span className="shrink-0 text-(--tmd-fg-muted)">#{result.prNumber}</span>
              )}
            </span>
            {result.prUrl && (
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded border border-(--tmd-border) px-2 py-1 text-xs text-(--tmd-fg) hover:bg-(--tmd-bg-hover)"
                onClick={() => onCopy(result.prUrl ?? "")}
              >
                <Copy className="h-[0.75rem] w-[0.75rem]" aria-hidden />
                {t("复制链接")}
              </button>
            )}
          </div>
          <div className="mt-1 break-words text-xs text-(--tmd-fg-muted)">
            {result.message.replace(ERR_PREFIX_RE, "")}
          </div>
        </div>
      )}
    </div>
  );
}

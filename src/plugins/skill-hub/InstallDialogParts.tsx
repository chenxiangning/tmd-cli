/**
 * 安装弹窗视图件 ── 冲突清单块与阶段结果块(InstallDialog 状态编排的
 * 纯展示拆件,控复杂度治理;状态全部由父组件注入)。
 */

import { t } from "@kernel/i18n";
import { ENGINE_LABELS } from "./skillScan";
import type { InstallConflict, InstallOutcome } from "./install";

const STAGE_LABELS: Record<InstallOutcome["stage"], string> = {
  download: "下载中…",
  extract: "解压安装中…",
  done: "安装完成",
  error: "安装失败",
};

export function InstallConflictsPanel({
  conflicts,
  overwrite,
  onToggle,
  busy,
}: {
  conflicts: readonly InstallConflict[];
  overwrite: ReadonlySet<string>;
  onToggle: (dir: string) => void;
  busy: boolean;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="mb-3 rounded border border-(--tmd-border) p-2" data-install-conflicts>
      <div className="mb-1 text-[11px] font-medium text-(--tmd-err)">
        {t("{n} 处落位目标已有同名技能", { n: conflicts.length })}
      </div>
      {conflicts.map((c) => (
        <div key={c.target.dir} className="mb-1 flex items-center gap-2 text-[11px]">
          <span className="min-w-0 flex-1 truncate" title={`${c.target.dir}/${c.name}`}>
            {t(ENGINE_LABELS[c.target.label] ?? c.target.label)} · {c.name}
          </span>
          <label className="flex cursor-pointer items-center gap-1">
            <input
              type="checkbox"
              checked={overwrite.has(c.target.dir)}
              onChange={() => onToggle(c.target.dir)}
              disabled={busy}
            />
            {t("覆盖(旧目录移入回收站)")}
          </label>
        </div>
      ))}
      <div className="text-[10px] text-(--tmd-fg-faint)">{t("不勾选 = 跳过该目标")}</div>
    </div>
  );
}

export function InstallStagePanel({
  stage,
  outcome,
}: {
  stage: InstallOutcome["stage"] | null;
  outcome: InstallOutcome | null;
}) {
  if (stage === null) return null;
  return (
    <div className="mb-3 rounded bg-(--tmd-bg-sunken) p-2 text-[11px]" data-install-stage={stage}>
      <div className={stage === "error" ? "text-(--tmd-err)" : ""}>
        {t(STAGE_LABELS[stage])}
      </div>
      {outcome && (
        <div className="mt-1 space-y-0.5">
          {outcome.targets.map((r) => (
            <div key={r.target.dir} className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate">
                {t(ENGINE_LABELS[r.target.label] ?? r.target.label)}
              </span>
              <span
                className={
                  r.state === "done"
                    ? "text-(--tmd-ok,green)"
                    : r.state === "failed"
                      ? "text-(--tmd-err)"
                      : "text-(--tmd-fg-faint)"
                }
              >
                {r.state === "done"
                  ? t("完成")
                  : r.state === "failed"
                    ? `${t("失败")}:${r.error}`
                    : t("跳过")}
              </span>
            </div>
          ))}
          {outcome.symlinkNote && (
            <div className="text-(--tmd-fg-muted)">
              {t("claude 补链失败(不影响安装)")}:{outcome.symlinkNote}
            </div>
          )}
        </div>
      )}
      {stage === "error" && outcome?.error && (
        <div className="mt-1 text-(--tmd-err)">{outcome.error}</div>
      )}
      {stage === "done" && (
        <div className="mt-1 text-[10px] text-(--tmd-fg-faint)">
          {t("生效时间依各家引擎而定:下次会话或 /reload-skills 后可用")}
        </div>
      )}
    </div>
  );
}

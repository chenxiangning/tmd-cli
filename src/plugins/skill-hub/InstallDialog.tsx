/**
 * 安装弹窗 ── 落位三选(引擎多选默认 claude / 公约位一份多家用 / claude
 * 补链勾选)+ 同名冲突裁决(覆盖 = 移回收站 / 跳过)+ 阶段态
 * (下载中 → 解压中 → 完成/失败逐目标)。完成后失效发现缓存(onInstalled);
 * 生效提示不带承诺(各家热重载差异,下次会话或 /reload-skills 生效)。
 *
 * 结构(300 行内/复杂度治理):本文件只持状态与编排;冲突清单与
 * 阶段结果两块视图拆至 InstallDialogParts.tsx。
 */

import { useEffect, useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";
import { t } from "@kernel/i18n";
import { useEscClose } from "@kernel/DialogShell";
import { ipc } from "@kernel/ipc";
import { getClawHubSkillDetail } from "./clawhub";
import type { ClawHubCard, ClawHubDetail } from "./clawhubNormalize";
import { ENGINE_LABELS, INSTALL_ENGINES } from "./skillScan";
import {
  probeInstallConflicts,
  runInstall,
  type InstallConflict,
  type InstallOutcome,
  type InstallTargetSpec,
} from "./install";
import { InstallConflictsPanel, InstallStagePanel } from "./InstallDialogParts";

export function InstallDialog({
  card,
  onClose,
  onInstalled,
}: {
  card: ClawHubCard;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [engines, setEngines] = useState<ReadonlySet<string>>(new Set(["claude"]));
  const [shared, setShared] = useState(false);
  const [claudeSymlink, setClaudeSymlink] = useState(false);
  const [conflicts, setConflicts] = useState<readonly InstallConflict[]>([]);
  const [overwrite, setOverwrite] = useState<ReadonlySet<string>>(new Set());
  const [detail, setDetail] = useState<ClawHubDetail | null>(null);
  const [stage, setStage] = useState<InstallOutcome["stage"] | null>(null);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);

  const spec: InstallTargetSpec = useMemo(
    () => ({ engines: [...engines], shared, claudeSymlink: shared && claudeSymlink }),
    [engines, shared, claudeSymlink],
  );

  /* 详情背景拉取(许可证/版本/发布者上下文;失败静默,不挡安装)。 */
  useEffect(() => {
    let alive = true;
    void getClawHubSkillDetail(card.slug, card.ownerHandle || undefined)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [card]);

  /* 落位选择变更 = 重探冲突(只读探测,不装)。 */
  // eslint-disable-next-line react-doctor/no-set-state-after-await-in-effect -- alive 守卫已防卸载后写入;冲突探测必须随落位选择重跑,非派生 state
  useEffect(() => {
    let alive = true;
    setConflicts([]);
    void (async () => {
      const home = await ipc.configHomeDir().catch(() => null);
      if (!alive || home === null) return;
      setConflicts(await probeInstallConflicts(home, card.slug, spec));
    })();
    return () => {
      alive = false;
    };
  }, [spec, card.slug]);

  const toggleEngine = (engine: string): void => {
    setEngines((prev) => {
      const next = new Set(prev);
      if (next.has(engine)) next.delete(engine);
      else next.add(engine);
      return next;
    });
  };

  const start = async (): Promise<void> => {
    if (spec.engines.length === 0 && !spec.shared) return;
    const result = await runInstall(
      card,
      spec,
      new Map([...overwrite].map((dir) => [dir, "overwrite"] as const)),
      setStage,
    );
    setOutcome(result);
    if (result.stage === "done") onInstalled();
  };

  const busy = stage === "download" || stage === "extract";
  useEscClose(onClose, busy); /* Esc 关闭;下载/解压中锁定 */

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40" role="presentation">
      <dialog
        open
        aria-label={t("安装技能")}
        className="relative m-0 flex max-h-[85%] w-[460px] flex-col overflow-auto rounded-md border border-(--tmd-border) bg-(--tmd-bg-elevated) p-4 text-left shadow-xl"
        data-install-dialog={card.slug}
      >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <div className="mb-2 flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{card.displayName}</div>
            <div className="text-[11px] text-(--tmd-fg-faint)">
              {card.ownerHandle ? `@${card.ownerHandle}` : t("发布者待消歧")}
              {detail?.latestVersion ? ` · v${detail.latestVersion}` : ""}
              {detail?.license ? ` · ${detail.license}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded p-1 text-(--tmd-fg-muted) hover:bg-(--tmd-bg-hover) disabled:opacity-40"
            aria-label={t("关闭")}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        {card.summary && (
          <div className="mb-3 line-clamp-3 text-[11px] leading-snug text-(--tmd-fg-muted)">
            {card.summary}
          </div>
        )}

        <div className="mb-1 text-[11px] font-medium">{t("安装到")}</div>
        <div className="mb-2 grid grid-cols-3 gap-1">
          {INSTALL_ENGINES.map((e) => (
            <label
              key={e.engine}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-(--tmd-border) px-2 py-1 text-[11px] hover:bg-(--tmd-bg-hover)"
            >
              <input
                type="checkbox"
                checked={engines.has(e.engine)}
                onChange={() => toggleEngine(e.engine)}
                disabled={busy}
              />
              {t(ENGINE_LABELS[e.engine] ?? e.engine)}
            </label>
          ))}
        </div>
        <label className="mb-1 flex cursor-pointer items-start gap-1.5 text-[11px]">
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
            disabled={busy}
            className="mt-0.5"
          />
          <span>
            {t("公约位 ~/.agents/skills(一份多家用)")}
            <span className="block text-[10px] text-(--tmd-fg-faint)">
              {t("codex/omp/pi/kimi/grok/qoder/opencode/dsh 原生读取此目录")}
            </span>
          </span>
        </label>
        <label
          className={`mb-3 flex items-start gap-1.5 text-[11px] ${shared ? "cursor-pointer" : "opacity-40"}`}
        >
          <input
            type="checkbox"
            checked={claudeSymlink}
            onChange={(e) => setClaudeSymlink(e.target.checked)}
            disabled={!shared || busy || engines.has("claude")}
            className="mt-0.5"
          />
          <span>
            {t("同步建 symlink 进 ~/.claude/skills(Claude 官方支持)")}
            <span className="block text-[10px] text-(--tmd-fg-faint)">
              {t("失败不阻断,仅提示")}
            </span>
          </span>
        </label>

        <InstallConflictsPanel
          conflicts={conflicts}
          overwrite={overwrite}
          onToggle={(dir) =>
            setOverwrite((prev) => {
              const next = new Set(prev);
              if (next.has(dir)) next.delete(dir);
              else next.add(dir);
              return next;
            })
          }
          busy={busy}
        />

        <InstallStagePanel stage={stage} outcome={outcome} />

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded border border-(--tmd-border) px-2.5 py-1 text-xs hover:bg-(--tmd-bg-hover) disabled:opacity-40"
          >
            {outcome?.stage === "done" ? t("关闭") : t("取消")}
          </button>
          {(!outcome || outcome.stage === "error") && (
            <button
              type="submit"
              disabled={busy || (spec.engines.length === 0 && !spec.shared)}
              className="rounded bg-(--tmd-accent) px-2.5 py-1 text-xs text-white disabled:opacity-40"
              data-install-start
            >
              {t("安装")}
            </button>
          )}
        </div>
      </form>
      </dialog>
    </div>
  );
}

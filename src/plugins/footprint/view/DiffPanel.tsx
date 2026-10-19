/**
 * footprint 主流宽 diff 面板:点抽屉文件行在此展开。
 * 30 天内走 checkpointBatchDiff;账本已清理 → 诚实降级(数字保留 + git 跳转入口)。
 */
import { useMemo } from "react";
import { t } from "@kernel/i18n";
import type { CkptPatch } from "@kernel/ipc";
import { EngTag, FicoButton, IcoFolder, IcoOpen } from "./bits";
import type { FileSel } from "./useFpFiles";

/** 一行 diff 的渲染分类。 */
type LineKind = "add" | "del" | "hunk" | "ctx";

function classifyLine(line: string): LineKind {
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("@@")) return "hunk";
  return "ctx";
}

const LINE_CLS: Record<LineKind, string> = {
  add: "bg-[color-mix(in_srgb,var(--tmd-diff-inserted)_14%,transparent)]",
  del: "bg-[color-mix(in_srgb,var(--tmd-diff-removed)_12%,transparent)]",
  hunk: "bg-[var(--tmd-bg-hover)] text-[var(--tmd-fg-muted)]",
  ctx: "",
};

export interface DiffPanelProps {
  path: string;
  patch: CkptPatch | null;
  /** patch 在途。 */
  loading: boolean;
  engine: string;
  /** true = rollup 无 batchId 命中(账本 30 天 TTL 已清理)。 */
  degraded: boolean;
  /** 当日该文件 ±(降级态仍展示)。 */
  add: number;
  del: number;
  onOpen: () => void;
  onReveal: () => void;
  onClose: () => void;
  /** 降级态「从 git 提交看改动」(真实跳转待接,先 toast)。 */
  onGitFallback: () => void;
}

export function DiffPanel({ path, patch, loading, engine, degraded, add, del, onOpen, onReveal, onClose, onGitFallback }: DiffPanelProps) {
  const lines = useMemo(() => (patch && !patch.binary ? patch.patch.split("\n").slice(0, 400) : []), [patch]);
  return (
    <div className="mx-1 mb-4 overflow-hidden rounded-xl border border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-panel)] shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--tmd-border,var(--tmd-border))] bg-[var(--tmd-bg-hover)] px-3 py-2 text-[11px] text-[var(--tmd-fg)]">
        <span className="font-mono font-semibold text-[var(--tmd-fg,var(--tmd-fg))]">{path}</span>
        <EngTag engine={engine} />
        {degraded ? (
          <span className="rounded border border-dashed border-[var(--tmd-border-strong,var(--tmd-border-strong))] px-1 text-[9.5px] font-semibold text-[var(--tmd-fg-muted)]">
            {t("账本已清理")}
          </span>
        ) : (
          <span className="rounded bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] px-1 text-[9.5px] font-semibold text-[var(--tmd-accent,var(--tmd-accent))]">
            {t("账本封口 diff")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <FicoButton title={t("打开文件")} onClick={onOpen}>
            <IcoOpen />
          </FicoButton>
          <FicoButton title={t("打开所在文件夹")} onClick={onReveal}>
            <IcoFolder />
          </FicoButton>
          <FicoButton title={t("关闭 diff")} onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </FicoButton>
        </span>
      </div>
      {degraded ? (
        <div className="p-4 text-center text-[12px] text-[var(--tmd-fg-muted)]">
          <div className="mb-1 text-[13px] font-semibold text-[var(--tmd-fg)]">{t("diff 已随账本清理(30 天 TTL)")}</div>
          <div>
            {t("数字仍在:该文件当日 +{add} / −{del} · 会话与 turn 索引保留", { add, del })}
          </div>
          <div className="mt-2 text-[11px]">{t("诚实降级 —— 功能卡与 ± 持久,字节层跟随账本生命周期")}</div>
          <button
            type="button"
            className="mt-2.5 rounded-md bg-[var(--tmd-bg-hover)] px-2.5 py-1 text-[11px] hover:bg-[var(--tmd-bg-elevated)]"
            onClick={onGitFallback}
          >
            {t("从 git 提交看改动 →")}
          </button>
        </div>
      ) : loading ? (
        <div className="p-4 text-center text-[12px] text-[var(--tmd-fg-muted)]">{t("载入 diff…")}</div>
      ) : patch?.binary ? (
        <div className="p-4 text-center text-[12px] text-[var(--tmd-fg-muted)]">{t("二进制文件,不展示 diff")}</div>
      ) : (
        <div className="max-h-[360px] overflow-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed">
          {(() => {
            const seen = new Map<string, number>();
            return lines.map((line) => {
              const kind = classifyLine(line);
              const base = `${kind}:${line.slice(0, 24)}`;
              const n = seen.get(base) ?? 0;
              seen.set(base, n + 1);
              const sign = kind === "add" ? "+" : kind === "del" ? "−" : " ";
              return (
                <div key={n === 0 ? base : `${base}#${n}`} className={`flex whitespace-pre ${LINE_CLS[kind]}`}>
                  <span className="w-9 flex-none pr-2 text-right text-[10.5px] text-[var(--tmd-fg-muted)] select-none" />
                  <span className="flex-1 pr-3">
                    {sign} {line}
                  </span>
                </div>
              );
            });
          })()}
          {lines.length === 0 && <div className="p-3 text-center text-[11.5px] text-[var(--tmd-fg-muted)]">{t("无 diff 内容")}</div>}
        </div>
      )}
    </div>
  );
}

/** 主流宽 diff 面板的外壳(条件渲染 + 动作接线,守 FootprintView 300 行)。 */
export function FpMainDiff({ fileSel, onClose, onOpenFile, onRevealFile, onGitFallback }: {
  fileSel: FileSel | null;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
  onGitFallback: () => void;
}) {
  if (!fileSel) return null;
  return (
    <div id="fp-main-diff" className="px-4">
      <DiffPanel
        path={fileSel.path}
        patch={fileSel.patch}
        loading={fileSel.loading}
        degraded={fileSel.degraded}
        engine={fileSel.engine}
        add={fileSel.add}
        del={fileSel.del}
        onOpen={() => onOpenFile(fileSel.path)}
        onReveal={() => onRevealFile(fileSel.path)}
        onClose={onClose}
        onGitFallback={onGitFallback}
      />
    </div>
  );
}

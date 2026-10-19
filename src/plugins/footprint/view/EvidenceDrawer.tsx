/**
 * footprint 右侧证据抽屉:功能卡的会话行(resume)+ 改动文件清单。
 * 点文件行 → 主流宽 diff 面板(状态由 FootprintView 持有)。
 */
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail } from "../dataSource";
import { cardFiles, fileBatch } from "../dataSource";
import { EngTag, FicoButton, Hi, IcoFolder, IcoOpen } from "./bits";

export interface EvidenceDrawerProps {
  card: FpCardView;
  detail: FpDayDetail;
  query: string;
  /** 当前选中文件 path(null = 未选)。 */
  selPath: string | null;
  onSelectFile: (path: string) => void;
  onResumeSession: (sid: string) => void;
  onOpenFile: (path: string) => void;
  onRevealFile: (path: string) => void;
}

/** 文件行的 ± 迷你条(绿色加/红色删;上限 38px,原型 pm 语义)。 */
function PmBars({ add, del }: { add: number; del: number }) {
  return (
    <span className="flex w-[74px] flex-none flex-col items-end gap-0.5">
      <span className="h-1 min-w-0.5 rounded-sm bg-emerald-500" style={{ width: `${Math.min(38, add / 6)}px` }} />
      <span className="h-1 min-w-0.5 rounded-sm bg-red-400" style={{ width: `${Math.min(38, del / 6)}px` }} />
      <span className="font-mono text-[10px] whitespace-nowrap tabular-nums">
        <span className="text-emerald-600">+{add}</span> <span className="text-red-500">−{del}</span>
      </span>
    </span>
  );
}

export function EvidenceDrawer({ card, detail, query, selPath, onSelectFile, onResumeSession, onOpenFile, onRevealFile }: EvidenceDrawerProps) {
  const files = cardFiles(detail.rollup, card);
  /* 卡会话行:卡引用的会话 id → rollup 元数据 / journal 行(标题) */
  const sessRows = card.sessions
    .map((sid) => ({
      sid,
      roll: detail.rollup?.sessions[sid] ?? null,
      row: detail.rows.find((r) => r.id === sid) ?? null,
    }))
    .sort((a, b) => (a.roll?.first ?? "") < (b.roll?.first ?? "") ? -1 : 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-start justify-between gap-2 border-b border-[var(--tmd-border,var(--tmd-border))] px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-bold">
            <Hi text={card.title} q={query} />
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--tmd-fg-muted)]">
            {detail.day} · {card.unverified ? t("会话引用未验证") : t("AI 归纳 · 会话引用已校验")}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <h4 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] font-bold tracking-wide text-[var(--tmd-fg-muted)]">
          {t("会话")}
          <span className="rounded-full bg-[var(--tmd-bg-hover)] px-1.5 text-[10.5px]">{sessRows.length}</span>
        </h4>
        {sessRows.map(({ sid, roll, row }) => (
          <div
            key={sid}
            className="group flex items-center gap-2 border-l-2 border-transparent px-4 py-1.5 text-[12.5px] transition-colors hover:bg-[var(--tmd-bg-hover)]"
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
              onClick={() => onResumeSession(sid)}
            >
              <EngTag engine={roll?.engine ?? row?.profileId ?? "?"} />
              <span className="min-w-0 flex-1 truncate">
                <Hi text={row?.title ?? `${t("会话")} ${sid.slice(0, 8)}`} q={query} />
              </span>
              <span className="flex-none font-mono text-[10.5px] text-[var(--tmd-fg-muted)]">
                {(roll?.first ?? "").slice(11, 16) || (row ? new Date(row.startedAt).toTimeString().slice(0, 5) : "")}
              </span>
            </button>
            <button
              type="button"
              className="flex-none rounded-md border border-[var(--tmd-accent-weak,var(--tmd-accent-soft))] bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))] px-2 py-px text-[10.5px] text-[var(--tmd-accent,var(--tmd-accent))] hover:brightness-95"
              onClick={() => onResumeSession(sid)}
            >
              resume
            </button>
          </div>
        ))}
        <h4 className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] font-bold tracking-wide text-[var(--tmd-fg-muted)]">
          {t("改动文件")}
          <span className="rounded-full bg-[var(--tmd-bg-hover)] px-1.5 text-[10.5px]">{files.length}</span>
          <span className="font-normal normal-case">{t("· 点文件在左侧出 diff · 数字永久,diff 随账本 30 天")}</span>
        </h4>
        {files.map(({ path, stat }) => {
          return (
            <div
              key={path}
              className={`flex items-center gap-2 border-l-2 px-4 py-1.5 text-[12px] transition-colors hover:bg-[var(--tmd-bg-hover)] ${selPath === path ? "border-l-[var(--tmd-accent,var(--tmd-accent))] bg-[var(--tmd-accent-weak,var(--tmd-accent-soft))]" : "border-transparent"}`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer truncate text-left font-mono text-[11.5px]"
                onClick={() => onSelectFile(path)}
              >
                <Hi text={path} q={query} />
                {stat.cfg && (
                  <span className="ml-1 flex-none rounded border border-amber-500 px-1 text-[9.5px] font-semibold text-amber-600">
                    {t("配置")}
                  </span>
                )}
              </button>
              <span className="flex flex-none gap-0.5">
                <FicoButton title={t("打开文件")} onClick={() => onOpenFile(path)}>
                  <IcoOpen />
                </FicoButton>
                <FicoButton title={t("打开所在文件夹")} onClick={() => onRevealFile(path)}>
                  <IcoFolder />
                </FicoButton>
              </span>
              {fileBatch(detail.rollup, stat) === null ? (
                <span className="flex-none text-[10px] text-[var(--tmd-fg-muted)]">{t("账本已清理")}</span>
              ) : (
                <PmBars add={stat.add} del={stat.del} />
              )}
            </div>
          );
        })}
        {files.length === 0 && (
          <div className="px-4 py-3 text-[11.5px] text-[var(--tmd-fg-muted)]">{t("该卡无文件级证据(账本窗口外或无写入)")}</div>
        )}
      </div>
    </div>
  );
}

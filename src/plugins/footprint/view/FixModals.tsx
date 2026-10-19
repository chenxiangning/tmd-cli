/**
 * 修正层二期浮层:合并到其他卡 / 拆分此卡 / 手动补归纳。
 * 全部以「当前生效卡」为基底整量写 .user.json(与重命名同一写盘路径),
 * AI 原档保留可回溯。自 FootprintView 拆出守 300 行铁则。
 */
import { useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail } from "../dataSource";
import type { FixDialog } from "./useFpFix";

const btnPrimary =
  "rounded-lg bg-[var(--tmd-accent)] px-2.5 py-1 text-[12px] text-[var(--tmd-accent-fg)] disabled:opacity-40";
const btnGhost =
  "rounded-lg px-2 py-1 text-[12px] text-[var(--tmd-fg-muted)] hover:text-[var(--tmd-fg)]";
const inputCls =
  "w-full rounded-lg border border-[var(--tmd-border)] bg-[var(--tmd-bg-input)] px-2.5 py-1 text-[12.5px] text-[var(--tmd-fg)] outline-none focus:border-[var(--tmd-accent)]";

function Shell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute bottom-16 left-1/2 z-40 w-[340px] -translate-x-1/2 rounded-xl border border-[var(--tmd-border)] bg-[var(--tmd-bg-elevated)] p-3 shadow-lg">
      <div className="mb-2 text-[12px] font-bold text-[var(--tmd-fg)]">{title}</div>
      {children}
      <div className="mt-2 flex justify-end gap-1.5">
        <button type="button" className={btnGhost} onClick={onClose}>
          {t("取消")}
        </button>
      </div>
    </div>
  );
}

/** 会话复选清单(sid + 引擎短名;勾选顺序无关,集合语义)。 */
function SessionChecks({
  entries, picked, onToggle,
}: {
  entries: [string, { engine: string }][];
  picked: Set<string>;
  onToggle: (sid: string) => void;
}) {
  if (entries.length === 0)
    return <div className="py-2 text-[11.5px] text-[var(--tmd-fg-muted)]">{t("该日无会话可勾选")}</div>;
  return (
    <div className="flex max-h-[168px] flex-col gap-1 overflow-y-auto">
      {entries.map(([sid, e]) => (
        <label key={sid} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-[12px] text-[var(--tmd-fg)] hover:bg-[var(--tmd-bg-hover)]">
          <input type="checkbox" checked={picked.has(sid)} onChange={() => onToggle(sid)} />
          <span className="truncate font-mono text-[11px]">{sid.slice(0, 8)}</span>
          <span className="ml-auto text-[10.5px] text-[var(--tmd-fg-muted)]">{e.engine}</span>
        </label>
      ))}
    </div>
  );
}

export interface FixModalsProps {
  dialog: FixDialog | null;
  detail: FpDayDetail | null;
  onMerge: (targetTitle: string) => void;
  onSplit: (newTitle: string, moveSids: string[]) => void;
  onManual: (card: FpCardView) => void;
  onClose: () => void;
}

export function FixModals(p: FixModalsProps) {
  const [splitTitle, setSplitTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mTitle, setMTitle] = useState("");
  const [mSummary, setMSummary] = useState("");
  const d = p.dialog;
  if (!d || !p.detail) return null;
  const cards = p.detail.cards;
  const sessionEntries = Object.entries(p.detail.rollup?.sessions ?? {}).map(
    ([sid, e]) => [sid, { engine: e.engine }] as [string, { engine: string }],
  );
  const toggle = (sid: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });

  if (d.kind === "merge") {
    const others = cards.filter((c) => c.title !== d.title);
    return (
      <Shell title={t("合并「{title}」到:", { title: d.title })} onClose={p.onClose}>
        {others.length === 0 ? (
          <div className="py-2 text-[11.5px] text-[var(--tmd-fg-muted)]">{t("当日没有其他卡可并入")}</div>
        ) : (
          <div className="flex flex-col gap-1">
            {others.map((c) => (
              <button
                key={c.title}
                type="button"
                className="rounded-lg px-2 py-1.5 text-left text-[12.5px] text-[var(--tmd-fg)] hover:bg-[var(--tmd-bg-hover)]"
                onClick={() => p.onMerge(c.title)}
              >
                {c.title}
                <span className="ml-1.5 text-[10.5px] text-[var(--tmd-fg-muted)]">
                  {t("{n} 场会话", { n: c.sessions.length })}
                </span>
              </button>
            ))}
          </div>
        )}
      </Shell>
    );
  }

  if (d.kind === "split") {
    const src = cards.find((c) => c.title === d.title);
    const entries = sessionEntries.filter(([sid]) => src?.sessions.includes(sid));
    return (
      <Shell title={t("拆分「{title}」", { title: d.title })} onClose={p.onClose}>
        <input
          autoFocus
          value={splitTitle}
          placeholder={t("新卡名称")}
          aria-label={t("新卡名称")}
          className={inputCls + " mb-2"}
          onChange={(e) => setSplitTitle(e.target.value)}
        />
        <SessionChecks entries={entries} picked={picked} onToggle={toggle} />
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className={btnPrimary}
            disabled={!splitTitle.trim() || picked.size === 0}
            onClick={() => p.onSplit(splitTitle.trim(), [...picked])}
          >
            {t("确定")}
          </button>
        </div>
      </Shell>
    );
  }

  /* manual:空态手动补归纳 */
  return (
    <Shell title={t("手动补归纳")} onClose={p.onClose}>
      <input
        autoFocus
        value={mTitle}
        placeholder={t("功能名称(≤12 字)")}
        aria-label={t("功能名称(≤12 字)")}
        className={inputCls + " mb-1.5"}
        onChange={(e) => setMTitle(e.target.value)}
      />
      <input
        value={mSummary}
        placeholder={t("一句话说明(≤40 字)")}
        aria-label={t("一句话说明(≤40 字)")}
        className={inputCls + " mb-2"}
        onChange={(e) => setMSummary(e.target.value)}
      />
      <SessionChecks entries={sessionEntries} picked={picked} onToggle={toggle} />
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          className={btnPrimary}
          disabled={!mTitle.trim() || picked.size === 0}
          onClick={() =>
            p.onManual({
              title: mTitle.trim(),
              summary: mSummary.trim(),
              sessions: [...picked],
              unverified: false,
            })
          }
        >
          {t("确定")}
        </button>
      </div>
    </Shell>
  );
}

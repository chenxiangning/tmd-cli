/**
 * 修正层二期浮层:合并到其他卡 / 拆分此卡 / 手动补归纳。
 * 全部以「当前生效卡」为基底整量写 .user.json(与重命名同一写盘路径),
 * AI 原档保留可回溯。自 FootprintView 拆出守 300 行铁则。
 */
import { useEffect, useRef, useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView, FpDayDetail } from "../dataSource";
import type { FixDialog } from "./useFpFix";

const inputCls =
  "w-full rounded-lg border border-[var(--tmd-border)] bg-[var(--tmd-bg-input)] px-2.5 py-1.5 text-[12.5px] text-[var(--tmd-fg)] outline-none focus:border-[var(--tmd-accent)]";

/** 统一浮层壳:标题 + 可选说明 + 内容 + 底部(取消/确定同行右置)。 */
function Shell({
  title, hint, submitDisabled, onSubmit, onClose, children,
}: {
  title: string;
  hint?: string;
  submitDisabled: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // 聚焦进刚召唤的弹层(对话框正确 a11y);JSX autoFocus 属性被 react-doctor 禁用。
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.querySelector("input")?.focus();
  }, []);
  return (
    <div className="absolute bottom-14 left-1/2 z-40 w-[380px] -translate-x-1/2 overflow-hidden rounded-xl border border-[var(--tmd-border)] bg-[var(--tmd-bg-elevated)] shadow-[var(--tmd-shadow-popover,0_8px_24px_rgba(0,0,0,0.35))]">
      <div className="border-b border-[var(--tmd-border)] px-4 pt-3 pb-2.5">
        <div className="text-[13px] font-bold text-[var(--tmd-fg)]">{title}</div>
        {hint && <div className="mt-0.5 text-[11px] text-[var(--tmd-fg-muted)]">{hint}</div>}
      </div>
      <div ref={bodyRef} className="flex flex-col gap-2.5 px-4 py-3">{children}</div>
      <div className="flex items-center justify-end gap-2 border-t border-[var(--tmd-border)] bg-[var(--tmd-bg-panel)] px-4 py-2.5">
        <button
          type="button"
          className="rounded-lg border border-[var(--tmd-border)] px-3 py-1.5 text-[12px] text-[var(--tmd-fg-muted)] hover:text-[var(--tmd-fg)]"
          onClick={onClose}
        >
          {t("取消")}
        </button>
        <button
          type="button"
          className="rounded-lg bg-[var(--tmd-accent)] px-3.5 py-1.5 text-[12px] font-semibold text-[var(--tmd-accent-fg)] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={submitDisabled}
          onClick={onSubmit}
        >
          {t("确定")}
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
    return (
      <div className="rounded-lg bg-[var(--tmd-bg-hover)] px-2.5 py-2 text-[11.5px] text-[var(--tmd-fg-muted)]">
        {t("该日无会话可勾选 · 可建不带会话引用的卡")}
      </div>
    );
  return (
    <div className="flex max-h-[150px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-[var(--tmd-border)] p-1">
      {entries.map(([sid, e]) => (
        <label key={sid} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12px] text-[var(--tmd-fg)] hover:bg-[var(--tmd-bg-hover)]">
          <input type="checkbox" checked={picked.has(sid)} onChange={() => onToggle(sid)} />
          <span className="truncate font-mono text-[11px]">{sid.slice(0, 8)}</span>
          <span className="ml-auto text-[10.5px] text-[var(--tmd-fg-muted)]">{e.engine}</span>
        </label>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-[11px] font-semibold text-[var(--tmd-fg-muted)]">{label}</div>
      {children}
    </label>
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
  /* detail 允许 null(当日明细加载失败也能补归纳,只是无会话可勾) */
  if (!d) return null;
  const cards = p.detail?.cards ?? [];
  const sessionEntries = Object.entries(p.detail?.rollup?.sessions ?? {}).map(
    ([sid, e]) => [sid, { engine: e.engine }] as [string, { engine: string }],
  );
  const toggle = (sid: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  const closeReset = () => {
    setSplitTitle("");
    setPicked(new Set());
    setMTitle("");
    setMSummary("");
    p.onClose();
  };

  if (d.kind === "merge") {
    const others = cards.filter((c) => c.title !== d.title);
    return (
      <Shell
        title={t("合并「{title}」到:", { title: d.title })}
        hint={t("并入后原卡会话归目标卡,原卡移除(AI 原档保留)")}
        submitDisabled
        onSubmit={() => {}}
        onClose={closeReset}
      >
        {others.length === 0 ? (
          <div className="rounded-lg bg-[var(--tmd-bg-hover)] px-2.5 py-2 text-[11.5px] text-[var(--tmd-fg-muted)]">
            {t("当日没有其他卡可并入")}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {others.map((c) => (
              <button
                key={c.title}
                type="button"
                className="flex items-center rounded-lg border border-[var(--tmd-border)] px-2.5 py-2 text-left text-[12.5px] text-[var(--tmd-fg)] hover:border-[var(--tmd-accent)] hover:bg-[var(--tmd-bg-hover)]"
                onClick={() => p.onMerge(c.title)}
              >
                <span className="truncate">{c.title}</span>
                <span className="ml-auto text-[10.5px] text-[var(--tmd-fg-muted)]">
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
    const srcSids = new Set(src?.sessions ?? []);
    const entries = sessionEntries.filter(([sid]) => srcSids.has(sid));
    return (
      <Shell
        title={t("拆分「{title}」", { title: d.title })}
        hint={t("勾选的会话移入新卡;源卡会话拆空则整卡移除")}
        submitDisabled={!splitTitle.trim() || picked.size === 0}
        onSubmit={() => {
          const t2 = splitTitle.trim();
          const sids = [...picked];
          closeReset();
          p.onSplit(t2, sids);
        }}
        onClose={closeReset}
      >
        <Field label={t("新卡名称")}>
          <input
            value={splitTitle}
            className={inputCls}
            onChange={(e) => setSplitTitle(e.target.value)}
          />
        </Field>
        <Field label={t("移入新卡的会话")}>
          <SessionChecks entries={entries} picked={picked} onToggle={toggle} />
        </Field>
      </Shell>
    );
  }

  /* manual:空态手动补归纳(允许不带会话引用的卡) */
  return (
    <Shell
      title={t("手动补归纳")}
      hint={t("为该日建一张功能卡;会话引用可选,留空即为纯文字卡")}
      submitDisabled={!mTitle.trim()}
      onSubmit={() => {
        const card: FpCardView = {
          title: mTitle.trim(),
          summary: mSummary.trim(),
          sessions: [...picked],
          unverified: false,
        };
        closeReset();
        p.onManual(card);
      }}
      onClose={closeReset}
    >
      <Field label={t("功能名称(≤12 字)")}>
        <input
          value={mTitle}
          className={inputCls}
          onChange={(e) => setMTitle(e.target.value)}
        />
      </Field>
      <Field label={t("一句话说明(≤40 字)")}>
        <input
          value={mSummary}
          className={inputCls}
          onChange={(e) => setMSummary(e.target.value)}
        />
      </Field>
      <Field label={t("关联会话(可选)")}>
        <SessionChecks entries={sessionEntries} picked={picked} onToggle={toggle} />
      </Field>
    </Shell>
  );
}

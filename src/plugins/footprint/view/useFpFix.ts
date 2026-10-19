/**
 * 修正层 hook(spec 管线 D):以当前生效卡为基底改后整量写 .user.json,
 * AI 原档保留可回溯;bumpFootprintRev 触发当日重读。
 * 二期:合并/拆分/手动补归纳(浮层见 FixModals)。自 FootprintView 拆出守 300 行铁则。
 */
import { useCallback, useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView } from "../dataSource";
import { saveUserCards } from "../rollup";
import { bumpFootprintRev } from "../fpTab";

export type FixDialog =
  | { kind: "merge"; title: string }
  | { kind: "split"; title: string }
  | { kind: "manual" };

interface UseFpFixDeps {
  sel: string;
  detail: { cards: FpCardView[] } | null;
  showToast: (msg: string) => void;
}

const uniq = (xs: string[]): string[] => [...new Set(xs)];

/** 合并(纯):源卡 sessions 并入目标卡(quote 缺失则继承),删源卡。 */
export function mergeCards(
  cards: FpCardView[], sourceTitle: string, targetTitle: string,
): FpCardView[] {
  const source = cards.find((c) => c.title === sourceTitle);
  if (!source) return cards;
  return cards
    .filter((c) => c.title !== sourceTitle)
    .map((c) =>
      c.title === targetTitle
        ? { ...c, sessions: uniq([...c.sessions, ...source.sessions]), quote: c.quote ?? source.quote }
        : c,
    );
}

/** 拆分(纯):勾选会话移入新卡(插源卡原位后);源卡拆空则整卡移除。 */
export function splitCard(
  cards: FpCardView[], sourceTitle: string, newTitle: string, moveSids: string[],
): FpCardView[] {
  const source = cards.find((c) => c.title === sourceTitle);
  if (!source || moveSids.length === 0) return cards;
  const rest = source.sessions.filter((sid) => !moveSids.includes(sid));
  const fresh: FpCardView = {
    title: newTitle,
    summary: "",
    sessions: moveSids,
    quote: source.quote && moveSids.includes(source.quote.sid) ? source.quote : undefined,
    unverified: source.unverified,
  };
  const out = cards
    .filter((c) => c.title !== sourceTitle || rest.length > 0)
    .map((c) => (c.title === sourceTitle ? { ...c, sessions: rest } : c));
  out.splice(out.findIndex((c) => c.title === sourceTitle) + 1, 0, fresh);
  return out;
}

export function useFpFix({ sel, detail, showToast }: UseFpFixDeps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [dialog, setDialog] = useState<FixDialog | null>(null);

  const writeUserCards = useCallback(
    async (cards: FpCardView[]) => {
      await saveUserCards(sel, {
        version: 1,
        cards: cards.map((c) => ({ title: c.title, summary: c.summary, sessions: c.sessions, quote: c.quote })),
      });
      bumpFootprintRev();
    },
    [sel],
  );

  const saved = useCallback(() => showToast(t("已写入修正层(.user.json)")), [showToast]);

  const submitRename = useCallback(() => {
    if (!renaming || !detail) return;
    const next = renameVal.trim();
    const cards = detail.cards.map((c) => (c.title === renaming && next ? { ...c, title: next } : c));
    setRenaming(null);
    void writeUserCards(cards).then(saved);
  }, [renaming, renameVal, detail, writeUserCards, saved]);

  const hideCard = useCallback(
    (title: string) => {
      if (!detail) return;
      const cards = detail.cards.filter((c) => c.title !== title);
      void writeUserCards(cards).then(() =>
        showToast(t("已隐藏该卡(AI 原卡保留,删 .user.json 可恢复)")),
      );
    },
    [detail, writeUserCards, showToast],
  );

  /* 合并:源卡 sessions 并入目标卡,删源卡。 */
  const submitMerge = useCallback(
    (targetTitle: string) => {
      if (!detail || dialog?.kind !== "merge") return;
      if (!detail.cards.some((c) => c.title === dialog.title)) return setDialog(null);
      setDialog(null);
      void writeUserCards(mergeCards(detail.cards, dialog.title, targetTitle)).then(saved);
    },
    [detail, dialog, writeUserCards, saved],
  );

  /* 拆分:勾选会话移入新卡;源卡会话被拆空则整卡移除。 */
  const submitSplit = useCallback(
    (newTitle: string, moveSids: string[]) => {
      if (!detail || dialog?.kind !== "split") return;
      setDialog(null);
      void writeUserCards(splitCard(detail.cards, dialog.title, newTitle, moveSids)).then(saved);
    },
    [detail, dialog, writeUserCards, saved],
  );

  /* 手动补归纳:空态建卡(user 层整量替换;无 AI 卡日无覆盖风险)。 */
  const submitManual = useCallback(
    (card: FpCardView) => {
      setDialog(null);
      void writeUserCards([card]).then(saved);
    },
    [writeUserCards, saved],
  );

  /* 修正菜单分发(重命名/合并/拆分/无关);FIX_ACTIONS 序对应。 */
  const openFixAction = useCallback(
    (a: string, fixCard: string | null) => {
      if (a === "重命名功能卡" && fixCard) {
        setRenaming(fixCard);
        setRenameVal(fixCard);
        return;
      }
      if (a === "合并到其他卡…" && fixCard) return setDialog({ kind: "merge", title: fixCard });
      if (a === "拆分此卡…" && fixCard) return setDialog({ kind: "split", title: fixCard });
      if (a === "标记为无关" && fixCard) hideCard(fixCard);
    },
    [setRenameVal, hideCard],
  );

  return {
    renaming, renameVal, setRenameVal, setRenaming, submitRename, hideCard,
    dialog, setDialog, submitMerge, submitSplit, submitManual, openFixAction,
  };
}

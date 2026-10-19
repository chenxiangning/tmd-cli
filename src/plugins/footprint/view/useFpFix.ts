/**
 * 修正层 hook(spec 管线 D):以当前生效卡为基底改后整量写 .user.json,
 * AI 原档保留可回溯;bumpFootprintRev 触发当日重读。
 * 自 FootprintView 拆出守 300 行铁则。
 */
import { useCallback, useState } from "react";
import { t } from "@kernel/i18n";
import type { FpCardView } from "../dataSource";
import { saveUserCards } from "../rollup";
import { bumpFootprintRev } from "../fpTab";

interface UseFpFixDeps {
  sel: string;
  detail: { cards: FpCardView[] } | null;
  showToast: (msg: string) => void;
}

export function useFpFix({ sel, detail, showToast }: UseFpFixDeps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

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

  const submitRename = useCallback(() => {
    if (!renaming || !detail) return;
    const next = renameVal.trim();
    const cards = detail.cards.map((c) => (c.title === renaming && next ? { ...c, title: next } : c));
    setRenaming(null);
    void writeUserCards(cards).then(() => showToast(t("已写入修正层(.user.json)")));
  }, [renaming, renameVal, detail, writeUserCards, showToast]);

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

  return { renaming, renameVal, setRenameVal, setRenaming, submitRename, hideCard };
}
